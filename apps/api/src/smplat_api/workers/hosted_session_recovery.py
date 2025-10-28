"""Worker wiring for hosted session recovery automation sweeps."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.hosted_checkout_session import HostedSessionRecoveryRun
from smplat_api.services.billing.recovery import HostedSessionRecoveryCommunicator
from smplat_api.services.billing.sessions import schedule_hosted_session_recovery

SessionFactory = Callable[[], Awaitable[AsyncSession]] | Callable[[], AsyncSession]
CommunicatorFactory = Callable[[], HostedSessionRecoveryCommunicator]


class HostedSessionRecoveryWorker:
    """Periodically schedules hosted session recovery attempts."""

    # meta: worker: hosted-session-recovery

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        communicator_factory: CommunicatorFactory | None = None,
        interval_seconds: int | None = None,
        limit: int | None = None,
        max_attempts: int | None = None,
        trigger_label: str | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._communicator_factory = communicator_factory or (
            lambda: HostedSessionRecoveryCommunicator.from_settings(settings)
        )
        self.interval_seconds = interval_seconds or settings.hosted_recovery_interval_seconds
        self._limit = limit or settings.hosted_recovery_limit
        self._max_attempts = max_attempts or settings.hosted_recovery_max_attempts
        self._trigger_label = trigger_label or settings.hosted_recovery_trigger_label
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        self.is_running = True
        logger.info(
            "Hosted session recovery worker started",
            interval_seconds=self.interval_seconds,
            limit=self._limit,
            max_attempts=self._max_attempts,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        logger.info("Hosted session recovery worker stopped")

    async def run_once(self, *, triggered_by: str | None = None) -> Dict[str, int]:
        """Execute a single scheduler run and persist structured metadata."""

        communicator = self._communicator_factory()
        trigger = triggered_by or self._trigger_label
        summary: Dict[str, int] = {"scheduled": 0, "notified": 0}

        session = await self._ensure_session()
        async with session as managed_session:
            run = HostedSessionRecoveryRun(triggered_by=trigger)
            managed_session.add(run)
            await managed_session.commit()
            await managed_session.refresh(run)

            try:
                summary = await schedule_hosted_session_recovery(
                    managed_session,
                    communicator,
                    limit=self._limit,
                    max_attempts=self._max_attempts,
                )
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                run.scheduled_count = summary.get("scheduled", 0)
                run.notified_count = summary.get("notified", 0)
                run.metadata_json = self._build_run_metadata(trigger, communicator)
                await managed_session.commit()
                logger.info(
                    "Hosted session recovery sweep completed",
                    run_id=str(run.id),
                    scheduled=run.scheduled_count,
                    notified=run.notified_count,
                    trigger=trigger,
                )
            except Exception as exc:
                await managed_session.rollback()
                run.status = "failed"
                run.completed_at = datetime.now(timezone.utc)
                run.error_message = str(exc)
                run.metadata_json = self._build_run_metadata(trigger, communicator, error=str(exc))
                managed_session.add(run)
                await managed_session.commit()
                logger.exception(
                    "Hosted session recovery sweep failed",
                    run_id=str(run.id),
                    error=str(exc),
                )
                raise

        return summary

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.run_once()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Hosted session recovery iteration failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session

    def _build_run_metadata(
        self,
        trigger: str,
        communicator: HostedSessionRecoveryCommunicator,
        *,
        error: str | None = None,
    ) -> Dict[str, object | None]:
        """Return structured metadata describing the worker invocation."""

        metadata: Dict[str, object | None] = {
            "limit": self._limit,
            "max_attempts": self._max_attempts,
            "triggered_by": trigger,
            "email_provider": getattr(communicator, "_email_provider_label", "unknown"),
            "chat_provider": getattr(communicator, "_sms_provider_label", "unknown"),
        }
        if error:
            metadata["error"] = error
        return metadata
