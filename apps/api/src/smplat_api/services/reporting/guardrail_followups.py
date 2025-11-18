from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.provider_guardrail_followup import ProviderGuardrailFollowUp
from smplat_api.models.provider_guardrail_status import ProviderGuardrailStatus


class GuardrailFollowUpService:
    """Persistence helpers for guardrail follow-up notes."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record_follow_up(
        self,
        *,
        provider_id: str,
        provider_name: str | None,
        action: str,
        notes: str | None,
        platform_context: dict[str, Any] | None,
        source: str = "manual",
        conversion_cursor: str | None = None,
        conversion_href: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> tuple[ProviderGuardrailFollowUp, ProviderGuardrailStatus | None]:
        entry = ProviderGuardrailFollowUp(
            provider_id=provider_id,
            provider_name=provider_name,
            action=action,
            notes=notes,
            platform_context=platform_context,
            conversion_cursor=conversion_cursor,
            conversion_href=conversion_href,
            attachments=attachments,
        )
        self._session.add(entry)
        await self._session.flush()
        status = await self._upsert_status(entry, source=source)
        await self._session.commit()
        await self._session.refresh(entry)
        if status is not None:
            await self._session.refresh(status)
        return entry, status

    async def list_follow_ups(
        self,
        provider_id: str,
        limit: int = 20,
        cursor: datetime | None = None,
    ) -> tuple[list[ProviderGuardrailFollowUp], ProviderGuardrailStatus | None]:
        stmt = (
            select(ProviderGuardrailFollowUp)
            .where(ProviderGuardrailFollowUp.provider_id == provider_id)
            .order_by(ProviderGuardrailFollowUp.created_at.desc())
            .limit(limit)
        )
        if cursor:
            stmt = stmt.where(ProviderGuardrailFollowUp.created_at < cursor)
        result = await self._session.execute(stmt)
        rows = list(result.scalars())
        status = await self._session.get(ProviderGuardrailStatus, provider_id)
        return rows, status

    async def _upsert_status(
        self,
        entry: ProviderGuardrailFollowUp,
        *,
        source: str,
    ) -> ProviderGuardrailStatus | None:
        current_status = await self._session.get(ProviderGuardrailStatus, entry.provider_id)
        if current_status is None:
            current_status = ProviderGuardrailStatus(provider_id=entry.provider_id)
            self._session.add(current_status)

        current_status.provider_name = entry.provider_name or current_status.provider_name
        current_status.last_action = entry.action
        current_status.last_source = source
        current_status.last_follow_up_id = entry.id

        if entry.action == "pause":
            current_status.is_paused = True
        elif entry.action == "resume":
            current_status.is_paused = False

        current_status.updated_at = datetime.now(timezone.utc)
        return current_status


__all__ = ["GuardrailFollowUpService"]
