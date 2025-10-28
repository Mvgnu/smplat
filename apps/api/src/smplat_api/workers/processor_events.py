"""Worker utilities for processor event replays."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Awaitable, Callable, Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.invoice import Invoice
from smplat_api.models.processor_event import (
    ProcessorEvent,
    fetch_events_for_replay,
    register_replay_attempt,
)
from smplat_api.models.webhook_event import WebhookProviderEnum
from smplat_api.services.billing.event_handlers import handle_stripe_event


class ReplayLimitExceededError(RuntimeError):
    """Raised when replay attempts exceed configured thresholds."""


class ProcessorEventReplayWorker:
    """Processes stored processor events for deterministic replays."""

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession] | Callable[[], Awaitable[AsyncSession]],
        *,
        max_attempts: int = 5,
    ) -> None:
        self._session_factory = session_factory
        self._max_attempts = max_attempts

    async def process_pending(
        self,
        *,
        limit: int = 50,
        providers: Iterable[WebhookProviderEnum] | None = None,
    ) -> int:
        """Process events flagged for replay."""

        session = await self._ensure_session()
        processed = 0
        async with session as db:
            events = await fetch_events_for_replay(db, limit=limit, providers=providers)
            for event in events:
                try:
                    await self._replay_single(db, event_id=event.id, force=False)
                    processed += 1
                except ReplayLimitExceededError:
                    continue
            if processed:
                await db.commit()
            else:
                await db.rollback()
        return processed

    async def replay_event(self, event_id: UUID, *, force: bool = False) -> ProcessorEvent:
        """Explicitly trigger replay for a single processor event."""

        session = await self._ensure_session()
        async with session as db:
            event = await self._replay_single(db, event_id=event_id, force=force)
            await db.commit()
            return event

    async def _replay_single(
        self,
        session: AsyncSession,
        *,
        event_id: UUID,
        force: bool,
    ) -> ProcessorEvent:
        event = await session.get(ProcessorEvent, event_id)
        if event is None:
            raise ValueError(f"Processor event {event_id} not found")

        if not force and event.replay_attempts >= self._max_attempts:
            raise ReplayLimitExceededError(f"Replay attempts exhausted for {event_id}")

        if event.payload_json is None:
            await register_replay_attempt(
                session,
                event=event,
                attempted_at=datetime.now(timezone.utc),
                error="missing_payload",
            )
            return event

        provider = event.provider
        if provider == WebhookProviderEnum.STRIPE:
            await self._apply_stripe_event(session, event)
        else:
            await register_replay_attempt(
                session,
                event=event,
                attempted_at=datetime.now(timezone.utc),
                error=f"unsupported_provider:{provider}",
            )

        return event

    async def _apply_stripe_event(self, session: AsyncSession, event: ProcessorEvent) -> None:
        payload = event.payload_json or {}
        event_type = payload.get("type")
        data_object = payload.get("data", {}).get("object", {})
        if not event_type or not data_object:
            await register_replay_attempt(
                session,
                event=event,
                attempted_at=datetime.now(timezone.utc),
                error="invalid_payload",
            )
            return

        invoice_id = event.invoice_id or self._extract_invoice_id(payload)
        if invoice_id is None:
            await register_replay_attempt(
                session,
                event=event,
                attempted_at=datetime.now(timezone.utc),
                error="missing_invoice",
            )
            return

        invoice = await session.get(Invoice, invoice_id)
        if invoice is None:
            await register_replay_attempt(
                session,
                event=event,
                attempted_at=datetime.now(timezone.utc),
                error="invoice_not_found",
            )
            return

        await handle_stripe_event(session, invoice, event_type, data_object)
        invoice.webhook_replay_token = event.external_id
        await register_replay_attempt(
            session,
            event=event,
            attempted_at=datetime.now(timezone.utc),
            error=None,
        )

    @staticmethod
    def _extract_invoice_id(payload: dict[str, object]) -> UUID | None:
        try:
            raw = payload.get("data", {}).get("object", {})
            metadata = raw.get("metadata", {}) if isinstance(raw, dict) else {}
            invoice_hint = metadata.get("invoice_id") if isinstance(metadata, dict) else None
            if invoice_hint:
                return UUID(str(invoice_hint))
        except (ValueError, TypeError):
            return None
        return None

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session
