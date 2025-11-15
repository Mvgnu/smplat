from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping
from uuid import UUID, uuid4

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.celery_app import celery_app
from smplat_api.core.settings import settings
from smplat_api.models import JourneyComponent, Product, ProductJourneyComponent
from smplat_api.models.journey_runtime import JourneyComponentRun, JourneyComponentRunStatusEnum
from smplat_api.schemas.product import JourneyComponentRunCreate


class JourneyRuntimeService:
    """Coordinates journey component runtime executions."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_run(self, payload: JourneyComponentRunCreate) -> JourneyComponentRun:
        component = await self._session.get(JourneyComponent, payload.component_id)
        if component is None:
            raise ValueError("Journey component not found")

        product, product_component = await self._resolve_product_context(payload, component.id)
        normalized_channel = self._normalize_channel(payload.channel)
        if normalized_channel and product_component is not None:
            channel_constraints = self._normalize_channels(product_component.channel_eligibility)
            if channel_constraints and normalized_channel not in channel_constraints:
                raise ValueError("Channel not eligible for this journey component")

        binding_snapshot = self._resolve_binding_payload(payload, product_component)

        run = JourneyComponentRun(
            run_token=self._build_run_token(),
            product_id=product.id if product else None,
            product_component_id=product_component.id if product_component else None,
            component_id=component.id,
            channel=normalized_channel,
            trigger=self._serialize_payload(payload.trigger),
            input_payload=self._serialize_payload(payload.input_payload),
            binding_snapshot=binding_snapshot,
            metadata_json=self._serialize_payload(payload.metadata),
            context=self._serialize_payload(payload.context),
            status=JourneyComponentRunStatusEnum.PENDING,
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)
        await self._enqueue_run(run)
        return run

    async def list_product_runs(self, product_id: UUID, *, limit: int = 25) -> list[JourneyComponentRun]:
        stmt = (
            select(JourneyComponentRun)
            .where(JourneyComponentRun.product_id == product_id)
            .order_by(JourneyComponentRun.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def list_pending_run_ids(self, *, limit: int = 25) -> list[UUID]:
        if limit <= 0:
            return []
        stmt = (
            select(JourneyComponentRun.id)
            .where(
                JourneyComponentRun.status.in_(
                    (
                        JourneyComponentRunStatusEnum.PENDING,
                        JourneyComponentRunStatusEnum.QUEUED,
                    )
                )
            )
            .order_by(JourneyComponentRun.created_at.asc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_run_with_context(self, run_id: UUID) -> JourneyComponentRun | None:
        stmt = (
            select(JourneyComponentRun)
            .options(
                selectinload(JourneyComponentRun.component),
                selectinload(JourneyComponentRun.product),
                selectinload(JourneyComponentRun.product_component).selectinload(ProductJourneyComponent.product),
            )
            .where(JourneyComponentRun.id == run_id)
            .limit(1)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def mark_run_started(self, run_id: UUID) -> JourneyComponentRun:
        run = await self._session.get(JourneyComponentRun, run_id)
        if not run:
            raise ValueError("Journey component run not found")
        now = datetime.now(timezone.utc)
        run.status = JourneyComponentRunStatusEnum.RUNNING
        run.started_at = now
        run.attempts = (run.attempts or 0) + 1
        await self._session.commit()
        await self._session.refresh(run)
        return run

    async def mark_run_completed(
        self,
        run_id: UUID,
        *,
        result: Mapping[str, Any] | None = None,
        error: str | None = None,
        status: JourneyComponentRunStatusEnum | None = None,
        telemetry: Mapping[str, Any] | None = None,
    ) -> JourneyComponentRun:
        run = await self._session.get(JourneyComponentRun, run_id)
        if not run:
            raise ValueError("Journey component run not found")
        now = datetime.now(timezone.utc)
        if error:
            run.status = status or JourneyComponentRunStatusEnum.FAILED
            run.error_message = error
        else:
            run.status = status or JourneyComponentRunStatusEnum.SUCCEEDED
            run.result_payload = dict(result) if isinstance(result, Mapping) else result
        if telemetry is not None:
            run.telemetry_json = dict(telemetry) if isinstance(telemetry, Mapping) else telemetry
        else:
            run.telemetry_json = None
        run.completed_at = now
        await self._session.commit()
        await self._session.refresh(run)
        return run

    async def requeue_run(self, run: JourneyComponentRun) -> JourneyComponentRun:
        await self._enqueue_run(run)
        return run

    @staticmethod
    def summarize_component_health(
        components: Iterable[ProductJourneyComponent],
        runs: Iterable[JourneyComponentRun],
    ) -> list["JourneyComponentHealthAggregate"]:
        summaries: dict[str, JourneyComponentHealthAggregate] = {}
        ordered_keys: list[str] = []

        def ensure_summary(
            component_id: Any,
            *,
            product_component_id: Any | None = None,
            display_order: int | None = None,
        ) -> JourneyComponentHealthAggregate:
            key = _build_component_key(product_component_id, component_id)
            summary = summaries.get(key)
            if summary is None:
                summary = JourneyComponentHealthAggregate(
                    component_id=component_id,
                    product_component_id=product_component_id,
                    display_order=display_order,
                )
                summaries[key] = summary
                ordered_keys.append(key)
            else:
                # Preserve latest known ordering metadata for attached components.
                if display_order is not None:
                    summary.display_order = display_order
                if product_component_id is not None and summary.product_component_id is None:
                    summary.product_component_id = product_component_id
            return summary

        for component in components:
            ensure_summary(
                component.component_id,
                product_component_id=component.id,
                display_order=component.display_order,
            )

        sorted_runs = sorted(
            runs,
            key=_resolve_run_timestamp,
            reverse=True,
        )
        for run in sorted_runs:
            summary = ensure_summary(
                run.component_id,
                product_component_id=run.product_component_id,
            )
            summary.run_count += 1
            if run.status == JourneyComponentRunStatusEnum.SUCCEEDED:
                summary.success_count += 1
            elif run.status == JourneyComponentRunStatusEnum.FAILED:
                summary.failure_count += 1
            if summary.last_run is None:
                summary.last_run = run

        # Stable ordering: attached components in display order, followed by orphaned summaries.
        def summary_sort_key(key: str) -> tuple[int, datetime]:
            summary = summaries[key]
            display_order = summary.display_order if summary.display_order is not None else 9999
            timestamp = _resolve_run_timestamp(summary.last_run)
            return (display_order, timestamp)

        ordered_keys.sort(key=summary_sort_key)
        return [summaries[key] for key in ordered_keys]

    async def _resolve_product_context(
        self,
        payload: JourneyComponentRunCreate,
        component_id: UUID,
    ) -> tuple[Product | None, ProductJourneyComponent | None]:
        product: Product | None = None
        product_component: ProductJourneyComponent | None = None

        if payload.product_component_id:
            stmt = (
                select(ProductJourneyComponent)
                .options(selectinload(ProductJourneyComponent.product))
                .where(ProductJourneyComponent.id == payload.product_component_id)
            )
            result = await self._session.execute(stmt)
            product_component = result.scalars().first()
            if product_component is None:
                raise ValueError("Product journey component not found")
            if product_component.component_id != component_id:
                raise ValueError("Journey component mismatch")
            product = product_component.product
        elif payload.product_id:
            product = await self._session.get(Product, payload.product_id)
            if product is None:
                raise ValueError("Product not found")
            product_component = await self._find_product_component(product.id, component_id)
            if product_component is None:
                raise ValueError("Journey component not attached to product")

        return product, product_component

    async def _find_product_component(
        self,
        product_id: UUID,
        component_id: UUID,
    ) -> ProductJourneyComponent | None:
        stmt = (
            select(ProductJourneyComponent)
            .where(
                ProductJourneyComponent.product_id == product_id,
                ProductJourneyComponent.component_id == component_id,
            )
            .limit(1)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    def _resolve_binding_payload(
        self,
        payload: JourneyComponentRunCreate,
        product_component: ProductJourneyComponent | None,
    ) -> list[dict[str, Any]] | None:
        binding_source = payload.bindings
        if binding_source:
            return [self._serialize_binding(binding) for binding in binding_source]
        if product_component and isinstance(product_component.bindings, Iterable):
            bindings_list = []
            for binding in product_component.bindings or []:
                if isinstance(binding, Mapping):
                    bindings_list.append(dict(binding))
            return bindings_list or None
        return None

    async def _enqueue_run(self, run: JourneyComponentRun) -> None:
        run.status = JourneyComponentRunStatusEnum.QUEUED
        run.queued_at = datetime.now(timezone.utc)
        await self._session.commit()
        await self._session.refresh(run)
        worker_enabled = settings.journey_runtime_worker_enabled
        broker_url = settings.celery_broker_url
        if not worker_enabled:
            logger.info(
                "Journey runtime worker disabled; run will remain queued",
                run_id=str(run.id),
                token=run.run_token,
            )
            return
        if not broker_url:
            logger.info(
                "Journey runtime Celery broker not configured; relying on local worker",
                run_id=str(run.id),
                token=run.run_token,
            )
            return
        try:
            celery_app.send_task(
                "journey_runtime.execute_component_run",
                args=[str(run.id)],
                queue=settings.journey_runtime_task_queue,
            )
        except Exception as exc:  # pragma: no cover - best effort enqueue
            logger.warning("Failed to enqueue journey component run", run_id=str(run.id), error=str(exc))

    @staticmethod
    def _serialize_payload(value: Any) -> dict | Any | None:
        if value is None:
            return None
        if isinstance(value, Mapping):
            return dict(value)
        if hasattr(value, "model_dump"):
            return value.model_dump(by_alias=True, exclude_none=True)  # type: ignore[attr-defined]
        return value

    @staticmethod
    def _serialize_binding(binding: Any) -> dict[str, Any]:
        if hasattr(binding, "model_dump"):
            return binding.model_dump(by_alias=True, exclude_none=True)  # type: ignore[attr-defined]
        if isinstance(binding, Mapping):
            return dict(binding)
        raise ValueError("Binding payload must be a mapping")

    @staticmethod
    def _build_run_token() -> str:
        return uuid4().hex

    @staticmethod
    def _normalize_channel(channel: str | None) -> str | None:
        if not channel:
            return None
        value = channel.strip().lower()
        return value or None

    @staticmethod
    def _normalize_channels(channels: Iterable[str] | None) -> list[str]:
        normalized: list[str] = []
        if not channels:
            return normalized
        for entry in channels:
            if not entry:
                continue
            token = entry.strip().lower()
            if token and token not in normalized:
                normalized.append(token)
        return normalized


@dataclass
class JourneyComponentHealthAggregate:
    component_id: Any
    product_component_id: Any | None
    display_order: int | None = None
    run_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    last_run: JourneyComponentRun | None = None


def _build_component_key(product_component_id: Any | None, component_id: Any) -> str:
    if product_component_id:
        return str(product_component_id)
    return f"component:{component_id}"


def _resolve_run_timestamp(run: JourneyComponentRun | None) -> datetime:
    if not run:
        return datetime.min.replace(tzinfo=timezone.utc)
    for attr in (run.completed_at, run.started_at, run.queued_at, run.created_at):
        if attr:
            return attr
    return datetime.min.replace(tzinfo=timezone.utc)


__all__ = ["JourneyRuntimeService", "JourneyComponentHealthAggregate"]
