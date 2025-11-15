from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.provider_automation_run import (
    ProviderAutomationRun,
    ProviderAutomationRunTypeEnum,
)


class ProviderAutomationRunService:
    """Persistence helpers for provider automation run history."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record_run(
        self,
        *,
        run_type: ProviderAutomationRunTypeEnum,
        summary: Mapping[str, Any],
        status: str = "success",
        metadata: Mapping[str, Any] | None = None,
        backlog_total: int | None = None,
        next_scheduled_at: datetime | None = None,
        alerts_sent: int | None = None,
    ) -> ProviderAutomationRun:
        normalized_summary = dict(summary)
        normalized_metadata = dict(metadata) if metadata else None
        normalized_next = self._ensure_timezone(next_scheduled_at) if next_scheduled_at else None
        run = ProviderAutomationRun(
            run_type=run_type,
            status=status,
            summary=normalized_summary,
            metadata_json=normalized_metadata,
            backlog_total=backlog_total,
            next_scheduled_at=normalized_next,
            alerts_sent=alerts_sent,
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)
        return run

    async def list_recent_runs(
        self,
        *,
        limit: int,
        run_type: ProviderAutomationRunTypeEnum,
    ) -> list[ProviderAutomationRun]:
        stmt = (
            select(ProviderAutomationRun)
            .where(ProviderAutomationRun.run_type == run_type)
            .order_by(ProviderAutomationRun.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    @staticmethod
    def to_status_payload(run: ProviderAutomationRun) -> dict[str, Any]:
        created_at = ProviderAutomationRunService._ensure_timezone(
            run.created_at or datetime.now(timezone.utc)
        )
        summary: dict[str, Any]
        if isinstance(run.summary, Mapping):
            summary = dict(run.summary)
        else:
            summary = {}
        if run.backlog_total is not None:
            summary.setdefault("scheduledBacklog", run.backlog_total)
        if run.next_scheduled_at is not None:
            next_eta = ProviderAutomationRunService._ensure_timezone(run.next_scheduled_at)
            summary.setdefault("nextScheduledAt", next_eta.isoformat())
        if run.alerts_sent is not None:
            summary.setdefault("alertsSent", run.alerts_sent)
        metadata = run.metadata_json
        if isinstance(metadata, Mapping):
            alerts_digest = metadata.get("alertsDigest")
            if alerts_digest is not None and "alertsDigest" not in summary:
                summary["alertsDigest"] = alerts_digest
            load_alerts_digest = metadata.get("loadAlertsDigest")
            if load_alerts_digest is not None and "loadAlertsDigest" not in summary:
                summary["loadAlertsDigest"] = load_alerts_digest
        return {
            "ranAt": created_at.isoformat(),
            "summary": summary,
        }

    @staticmethod
    def _ensure_timezone(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


__all__ = ["ProviderAutomationRunService", "ProviderAutomationRunTypeEnum"]
