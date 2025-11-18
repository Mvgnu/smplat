from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession
from smplat_api.db.session import get_session
from smplat_api.models.fulfillment import (
    FulfillmentProviderHealthStatusEnum,
    FulfillmentProviderStatusEnum,
    FulfillmentServiceStatusEnum,
)
from smplat_api.schemas.fulfillment_provider import (
    FulfillmentProviderCreate,
    FulfillmentProviderResponse,
    FulfillmentProviderUpdate,
    FulfillmentServiceCreate,
    FulfillmentServiceResponse,
    FulfillmentServiceUpdate,
    FulfillmentProviderOrderResponse,
    FulfillmentProviderOrderRefillEntry,
    FulfillmentProviderOrderRefillRequest,
    FulfillmentProviderOrderReplayEntry,
    FulfillmentProviderOrderReplayRequest,
    ProviderAutomationSnapshotResponse,
    ProviderAutomationStatusResponse,
    ProviderAutomationHistoryResponse,
    ProviderAutomationRunStatus,
    ProviderServiceMetadata,
)
from smplat_api.services.fulfillment.provider_catalog_service import (
    ProviderCatalogService,
    UNSET,
)
from smplat_api.services.fulfillment import (
    ProviderAutomationService,
    ProviderAutomationRunService,
    ProviderAutomationRunTypeEnum,
)
from smplat_api.services.fulfillment.automation_status_service import AutomationStatusService
from smplat_api.tasks.provider_replay import run_scheduled_replays
from smplat_api.tasks.provider_alerts import run_provider_alerts
from smplat_api.services.fulfillment.provider_endpoints import ProviderEndpointError
from smplat_api.services.providers.platform_context_cache import ProviderPlatformContextCacheService
from smplat_api.services.orders.state_machine import OrderStateMachine, OrderStateEventTypeEnum, OrderStateActorTypeEnum

router = APIRouter(prefix="/fulfillment/providers", tags=["Fulfillment Providers"])


class ProviderPlatformContextPayload(BaseModel):
    id: str
    label: str
    handle: str | None = None
    platform_type: str | None = Field(default=None, alias="platformType")


class ProviderPlatformContextResponse(BaseModel):
    provider_id: str = Field(alias="providerId")
    contexts: list[ProviderPlatformContextPayload] = Field(default_factory=list)


def _serialize_service_metadata(metadata: ProviderServiceMetadata | dict[str, Any] | None) -> dict[str, Any] | None:
    if metadata is None:
        return None
    if isinstance(metadata, ProviderServiceMetadata):
        return metadata.model_dump(by_alias=True, exclude_none=True)
    if isinstance(metadata, dict):
        return metadata
    return None


async def get_provider_catalog_service(session=Depends(get_session)) -> ProviderCatalogService:
    return ProviderCatalogService(session)


async def get_provider_automation_service(session=Depends(get_session)) -> ProviderAutomationService:
    return ProviderAutomationService(session)


async def get_automation_status_service() -> AutomationStatusService:
    return AutomationStatusService()


async def get_provider_automation_run_service(
    session=Depends(get_session),
) -> ProviderAutomationRunService:
    return ProviderAutomationRunService(session)


async def get_provider_platform_context_cache_service(
    session=Depends(get_session),
) -> ProviderPlatformContextCacheService:
    return ProviderPlatformContextCacheService(session)




@router.get(
    "/",
    summary="List fulfillment providers",
    response_model=list[FulfillmentProviderResponse],
)
async def list_providers(
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> list[FulfillmentProviderResponse]:
    providers = await service.list_providers()
    return [FulfillmentProviderResponse.model_validate(provider) for provider in providers]


@router.get(
    "/platform-contexts",
    summary="List cached platform contexts for providers",
    response_model=list[ProviderPlatformContextResponse],
)
async def list_provider_platform_contexts(
    provider_ids: list[str] = Query(..., alias="providerId"),
    limit: int = Query(3, ge=1, le=10),
    cache_service: ProviderPlatformContextCacheService = Depends(get_provider_platform_context_cache_service),
) -> list[ProviderPlatformContextResponse]:
    normalized_ids = [provider_id for provider_id in provider_ids if provider_id]
    mapping = await cache_service.fetch_contexts_for_providers(normalized_ids, limit_per_provider=limit)
    response: list[ProviderPlatformContextResponse] = []
    for provider_id in normalized_ids:
        rows = mapping.get(provider_id, [])
        response.append(
            ProviderPlatformContextResponse(
                providerId=provider_id,
                contexts=[
                    ProviderPlatformContextPayload(
                        id=record.platform_id,
                        label=record.label,
                        handle=record.handle,
                        platformType=record.platform_type,
                    )
                    for record in rows
                ],
            )
        )
    return response


@router.get(
    "/{provider_id}",
    summary="Get provider detail",
    response_model=FulfillmentProviderResponse,
)
async def get_provider(
    provider_id: str, service: ProviderCatalogService = Depends(get_provider_catalog_service)
) -> FulfillmentProviderResponse:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return FulfillmentProviderResponse.model_validate(provider)


@router.post(
    "/{provider_id}/balance/refresh",
    summary="Refresh provider balance snapshot",
    response_model=FulfillmentProviderResponse,
)
async def refresh_provider_balance(
    provider_id: str,
    catalog: ProviderCatalogService = Depends(get_provider_catalog_service),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
) -> FulfillmentProviderResponse:
    provider = await catalog.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    try:
        await automation.refresh_balance(provider_id)
    except ProviderEndpointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    refreshed = await catalog.get_provider(provider_id)
    return FulfillmentProviderResponse.model_validate(refreshed or provider)


@router.get(
    "/{provider_id}/orders",
    summary="List provider orders",
    response_model=list[FulfillmentProviderOrderResponse],
)
async def list_provider_orders(
    provider_id: str,
    limit: int = Query(25, ge=1, le=250),
    catalog: ProviderCatalogService = Depends(get_provider_catalog_service),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
) -> list[FulfillmentProviderOrderResponse]:
    provider = await catalog.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    orders = await automation.list_provider_orders(provider_id, limit)
    return [FulfillmentProviderOrderResponse.model_validate(order) for order in orders]


@router.get(
    "/automation/snapshot",
    summary="Provider automation snapshot",
    response_model=ProviderAutomationSnapshotResponse,
)
async def get_provider_automation_snapshot(
    limit_per_provider: int = Query(25, ge=1, le=250, alias="limitPerProvider"),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
) -> ProviderAutomationSnapshotResponse:
    return await automation.build_snapshot(limit_per_provider=limit_per_provider)


@router.get(
    "/automation/status",
    summary="Provider automation run status",
    response_model=ProviderAutomationStatusResponse,
)
async def get_provider_automation_status(
    status_service: AutomationStatusService = Depends(get_automation_status_service),
    run_service: ProviderAutomationRunService = Depends(get_provider_automation_run_service),
) -> ProviderAutomationStatusResponse:
    status_payload = await status_service.get_status()
    await _backfill_status_with_history(status_payload, run_service)
    return ProviderAutomationStatusResponse.model_validate(status_payload)


@router.get(
    "/automation/status/history",
    summary="Provider automation run history",
    response_model=ProviderAutomationHistoryResponse,
)
async def get_provider_automation_history(
    limit: int = Query(10, ge=1, le=100),
    run_service: ProviderAutomationRunService = Depends(get_provider_automation_run_service),
) -> ProviderAutomationHistoryResponse:
    replay_runs = await run_service.list_recent_runs(limit=limit, run_type=ProviderAutomationRunTypeEnum.REPLAY)
    alert_runs = await run_service.list_recent_runs(limit=limit, run_type=ProviderAutomationRunTypeEnum.ALERT)
    replay_payloads = [ProviderAutomationRunStatus.model_validate(run_service.to_status_payload(run)) for run in replay_runs]
    alert_payloads = [ProviderAutomationRunStatus.model_validate(run_service.to_status_payload(run)) for run in alert_runs]
    return ProviderAutomationHistoryResponse(replay=replay_payloads, alerts=alert_payloads)


@router.post(
    "/automation/replay/run",
    summary="Trigger provider replay worker once",
    response_model=ProviderAutomationRunStatus,
)
async def trigger_provider_replay_run(
    limit: int | None = Query(None, ge=1, le=500),
    status_service: AutomationStatusService = Depends(get_automation_status_service),
) -> ProviderAutomationRunStatus:
    await run_scheduled_replays(limit=limit)
    status_payload = await status_service.get_status()
    replay_status = status_payload.get("replay")
    if not replay_status:
        replay_status = {
            "ranAt": datetime.now(timezone.utc).isoformat(),
            "summary": {"processed": 0, "succeeded": 0, "failed": 0},
        }
    return ProviderAutomationRunStatus.model_validate(replay_status)


@router.post(
    "/automation/alerts/run",
    summary="Trigger provider automation alert worker once",
    response_model=ProviderAutomationRunStatus,
)
async def trigger_provider_alert_run(
    status_service: AutomationStatusService = Depends(get_automation_status_service),
) -> ProviderAutomationRunStatus:
    await run_provider_alerts()
    status_payload = await status_service.get_status()
    alert_status = status_payload.get("alerts")
    if not alert_status:
        alert_status = {
            "ranAt": datetime.now(timezone.utc).isoformat(),
            "summary": {"alertsSent": 0},
        }
    return ProviderAutomationRunStatus.model_validate(alert_status)


async def _backfill_status_with_history(
    payload: dict[str, Any],
    run_service: ProviderAutomationRunService,
) -> None:
    await _maybe_backfill_status_entry(
        payload,
        key="replay",
        run_type=ProviderAutomationRunTypeEnum.REPLAY,
        required_fields=("scheduledBacklog", "nextScheduledAt"),
        run_service=run_service,
    )
    await _maybe_backfill_status_entry(
        payload,
        key="alerts",
        run_type=ProviderAutomationRunTypeEnum.ALERT,
        required_fields=("alertsDigest",),
        run_service=run_service,
    )


async def _maybe_backfill_status_entry(
    payload: dict[str, Any],
    *,
    key: str,
    run_type: ProviderAutomationRunTypeEnum,
    required_fields: tuple[str, ...],
    run_service: ProviderAutomationRunService,
) -> None:
    raw_entry = payload.get(key)
    entry: dict[str, Any] | None = raw_entry if isinstance(raw_entry, dict) else None
    summary: Mapping[str, Any] | None = None
    needs_entry = entry is None
    missing_fields: list[str] = []

    if not needs_entry:
        summary_obj = entry.get("summary")
        if isinstance(summary_obj, Mapping):
            summary = summary_obj
        else:
            summary = {}
            entry["summary"] = summary
        for field in required_fields:
            if field not in summary:
                missing_fields.append(field)
    else:
        missing_fields = list(required_fields)

    if not missing_fields and not needs_entry:
        return

    runs = await run_service.list_recent_runs(limit=1, run_type=run_type)
    if not runs:
        return

    fallback = run_service.to_status_payload(runs[0])
    fallback_summary = fallback.get("summary", {})

    if needs_entry:
        payload[key] = fallback
        return

    if not isinstance(summary, dict):
        summary = dict(summary or {})
        entry["summary"] = summary

    for field in required_fields:
        if field in summary:
            continue
        value = fallback_summary.get(field)
        if value is not None:
            summary[field] = value


@router.post(
    "/{provider_id}/orders/{provider_order_id}/refill",
    summary="Trigger provider refill",
    response_model=FulfillmentProviderOrderRefillEntry,
)
async def trigger_provider_refill(
    provider_id: str,
    provider_order_id: UUID,
    payload: FulfillmentProviderOrderRefillRequest,
    catalog: ProviderCatalogService = Depends(get_provider_catalog_service),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
    session: AsyncSession = Depends(get_session),
) -> FulfillmentProviderOrderRefillEntry:
    provider = await catalog.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider_order = await automation.get_provider_order(provider_id, provider_order_id)
    if not provider_order:
        raise HTTPException(status_code=404, detail="Provider order not found")
    try:
        entry = await automation.trigger_refill(provider_order, amount=payload.amount)
    except ProviderEndpointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if provider_order.order_id:
        machine = OrderStateMachine(session)
        try:
            await machine.record_event(
                order_id=provider_order.order_id,
                event_type=OrderStateEventTypeEnum.REFILL_COMPLETED,
                actor_type=OrderStateActorTypeEnum.OPERATOR,
                actor_id=str(provider_order_id),
                actor_label=payload.actorLabel,
                notes=payload.note,
                metadata=ProviderAutomationService.build_timeline_metadata(
                    provider_order,
                    entry=entry,
                    extra={"providerId": provider_id},
                ),
            )
        except Exception:
            # do not fail the proxy call when audit logging experiences transient errors
            logger.exception("Failed to record refill timeline event", order_id=str(provider_order.order_id))
    return FulfillmentProviderOrderRefillEntry.model_validate(entry)


@router.get(
    "/orders/by-order/{order_id}",
    summary="List provider orders for an order",
    response_model=list[FulfillmentProviderOrderResponse],
)
async def list_orders_for_order(
    order_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
) -> list[FulfillmentProviderOrderResponse]:
    orders = await automation.list_orders_for_order(order_id, limit=limit)
    return [FulfillmentProviderOrderResponse.model_validate(order) for order in orders]


@router.post(
    "/{provider_id}/orders/{provider_order_id}/replay",
    summary="Replay provider order",
    response_model=FulfillmentProviderOrderReplayEntry,
)
async def replay_provider_order(
    provider_id: str,
    provider_order_id: UUID,
    payload: FulfillmentProviderOrderReplayRequest,
    catalog: ProviderCatalogService = Depends(get_provider_catalog_service),
    automation: ProviderAutomationService = Depends(get_provider_automation_service),
    session: AsyncSession = Depends(get_session),
) -> FulfillmentProviderOrderReplayEntry:
    provider = await catalog.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider_order = await automation.get_provider_order(provider_id, provider_order_id)
    if not provider_order:
        raise HTTPException(status_code=404, detail="Provider order not found")

    entry: Mapping[str, Any] | None = None
    event_type = None
    event_notes: str | None = None
    try:
        if payload.run_at and payload.schedule_only:
            entry = await automation.schedule_provider_order_replay(
                provider_order,
                run_at=payload.run_at,
                amount=payload.amount,
            )
            event_type = OrderStateEventTypeEnum.REPLAY_SCHEDULED
            scheduled_for = entry.get("scheduledFor") or payload.run_at.isoformat()
            event_notes = f"Replay scheduled for {scheduled_for}"
        elif payload.run_at and payload.run_at > datetime.now(timezone.utc):
            entry = await automation.schedule_provider_order_replay(
                provider_order,
                run_at=payload.run_at,
                amount=payload.amount,
            )
            event_type = OrderStateEventTypeEnum.REPLAY_SCHEDULED
            scheduled_for = entry.get("scheduledFor") or payload.run_at.isoformat()
            event_notes = f"Replay scheduled for {scheduled_for}"
        else:
            entry = await automation.replay_provider_order(provider_order, amount=payload.amount)
            event_type = OrderStateEventTypeEnum.REPLAY_EXECUTED
            event_notes = None
    except ProviderEndpointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if provider_order.order_id and event_type and entry is not None:
        metadata = ProviderAutomationService.build_timeline_metadata(
            provider_order,
            entry=entry,
            extra={
                "providerId": provider_id,
                "trigger": "admin_replay",
            },
        )
        machine = OrderStateMachine(session)
        try:
            await machine.record_event(
                order_id=provider_order.order_id,
                event_type=event_type,
                actor_type=OrderStateActorTypeEnum.OPERATOR,
                actor_id=str(provider_order_id),
                actor_label=None,
                notes=event_notes,
                metadata=metadata,
            )
        except Exception:
            logger.exception(
                "Failed to record replay timeline event",
                order_id=str(provider_order.order_id),
                event_type=event_type.value,
            )
    return FulfillmentProviderOrderReplayEntry.model_validate(entry)


@router.post(
    "/",
    summary="Create fulfillment provider",
    response_model=FulfillmentProviderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_provider(
    payload: FulfillmentProviderCreate,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> FulfillmentProviderResponse:
    existing = await service.get_provider(payload.id)
    if existing:
        raise HTTPException(status_code=409, detail="Provider already exists")

    status_enum = FulfillmentProviderStatusEnum(payload.status)
    health_status_enum = (
        FulfillmentProviderHealthStatusEnum(payload.health_status)
        if payload.health_status
        else FulfillmentProviderHealthStatusEnum.UNKNOWN
    )

    provider = await service.create_provider(
        provider_id=payload.id,
        name=payload.name,
        description=payload.description,
        base_url=payload.base_url,
        allowed_regions=payload.allowed_regions,
        credentials=payload.credentials,
        metadata=payload.metadata,
        rate_limit_per_minute=payload.rate_limit_per_minute,
        status=status_enum,
        health_status=health_status_enum,
    )
    refreshed = await service.get_provider(provider.id)
    return FulfillmentProviderResponse.model_validate(refreshed or provider)


@router.patch(
    "/{provider_id}",
    summary="Update fulfillment provider",
    response_model=FulfillmentProviderResponse,
)
async def update_provider(
    provider_id: str,
    payload: FulfillmentProviderUpdate,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> FulfillmentProviderResponse:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    update_data = payload.model_dump(exclude_unset=True)
    kwargs = {
        "name": update_data.get("name", UNSET),
        "description": update_data.get("description", UNSET),
        "base_url": update_data.get("base_url", UNSET),
        "allowed_regions": update_data.get("allowed_regions", UNSET),
        "credentials": update_data.get("credentials", UNSET),
        "metadata": update_data.get("metadata", UNSET),
        "rate_limit_per_minute": update_data.get("rate_limit_per_minute", UNSET),
        "health_payload": update_data.get("health_payload", UNSET),
        "last_health_check_at": update_data.get("last_health_check_at", UNSET),
    }
    if "status" in update_data:
        kwargs["status"] = FulfillmentProviderStatusEnum(update_data["status"])
    else:
        kwargs["status"] = UNSET
    if "health_status" in update_data:
        kwargs["health_status"] = FulfillmentProviderHealthStatusEnum(update_data["health_status"])
    else:
        kwargs["health_status"] = UNSET

    updated = await service.update_provider(provider, **kwargs)
    refreshed = await service.get_provider(updated.id)
    return FulfillmentProviderResponse.model_validate(refreshed or updated)


@router.delete(
    "/{provider_id}",
    summary="Delete fulfillment provider",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_provider(
    provider_id: str, service: ProviderCatalogService = Depends(get_provider_catalog_service)
) -> None:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    await service.delete_provider(provider)


@router.post(
    "/{provider_id}/services",
    summary="Create provider service",
    response_model=FulfillmentServiceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_service(
    provider_id: str,
    payload: FulfillmentServiceCreate,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> FulfillmentServiceResponse:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    existing = next((svc for svc in provider.services if svc.id == payload.id), None)
    if existing:
        raise HTTPException(status_code=409, detail="Service already exists for provider")

    status_enum = FulfillmentServiceStatusEnum(payload.status)
    health_status_enum = (
        FulfillmentProviderHealthStatusEnum(payload.health_status)
        if payload.health_status
        else FulfillmentProviderHealthStatusEnum.UNKNOWN
    )

    service_model = await service.create_service(
        service_id=payload.id,
        provider=provider,
        name=payload.name,
        action=payload.action,
        category=payload.category,
        default_currency=payload.default_currency,
        allowed_regions=payload.allowed_regions,
        credentials=payload.credentials,
        metadata=_serialize_service_metadata(payload.metadata),
        rate_limit_per_minute=payload.rate_limit_per_minute,
        status=status_enum,
    )
    if payload.health_status:
        service_model = await service.update_service(
            service_model,
            health_status=health_status_enum,
        )
    refreshed_provider = await service.get_provider(provider_id)
    created_service = next(
        (svc for svc in (refreshed_provider.services if refreshed_provider else []) if svc.id == payload.id),
        service_model,
    )
    return FulfillmentServiceResponse.model_validate(created_service)


@router.get(
    "/{provider_id}/services/{service_id}",
    summary="Get provider service detail",
    response_model=FulfillmentServiceResponse,
)
async def get_service_detail(
    provider_id: str,
    service_id: str,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> FulfillmentServiceResponse:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    service_model = next((svc for svc in provider.services if svc.id == service_id), None)
    if not service_model:
        raise HTTPException(status_code=404, detail="Service not found")
    return FulfillmentServiceResponse.model_validate(service_model)


@router.patch(
    "/{provider_id}/services/{service_id}",
    summary="Update provider service",
    response_model=FulfillmentServiceResponse,
)
async def update_service(
    provider_id: str,
    service_id: str,
    payload: FulfillmentServiceUpdate,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> FulfillmentServiceResponse:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    service_model = next((svc for svc in provider.services if svc.id == service_id), None)
    if not service_model:
        raise HTTPException(status_code=404, detail="Service not found")

    update_data = payload.model_dump(exclude_unset=True)
    kwargs = {
        "name": update_data.get("name", UNSET),
        "action": update_data.get("action", UNSET),
        "category": update_data.get("category", UNSET),
        "default_currency": update_data.get("default_currency", UNSET),
        "allowed_regions": update_data.get("allowed_regions", UNSET),
        "credentials": update_data.get("credentials", UNSET),
        "rate_limit_per_minute": update_data.get("rate_limit_per_minute", UNSET),
        "health_payload": update_data.get("health_payload", UNSET),
        "last_health_check_at": update_data.get("last_health_check_at", UNSET),
    }
    if "metadata" in update_data:
        kwargs["metadata"] = _serialize_service_metadata(update_data["metadata"])
    else:
        kwargs["metadata"] = UNSET
    if "status" in update_data:
        kwargs["status"] = FulfillmentServiceStatusEnum(update_data["status"])
    else:
        kwargs["status"] = UNSET
    if "health_status" in update_data:
        kwargs["health_status"] = FulfillmentProviderHealthStatusEnum(update_data["health_status"])
    else:
        kwargs["health_status"] = UNSET

    updated = await service.update_service(service_model, **kwargs)
    refreshed_provider = await service.get_provider(provider_id)
    refreshed_service = next(
        (svc for svc in (refreshed_provider.services if refreshed_provider else []) if svc.id == service_id),
        updated,
    )
    return FulfillmentServiceResponse.model_validate(refreshed_service)


@router.delete(
    "/{provider_id}/services/{service_id}",
    summary="Delete provider service",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_service(
    provider_id: str,
    service_id: str,
    service: ProviderCatalogService = Depends(get_provider_catalog_service),
) -> None:
    provider = await service.get_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    service_model = next((svc for svc in provider.services if svc.id == service_id), None)
    if not service_model:
        raise HTTPException(status_code=404, detail="Service not found")
    await service.delete_service(service_model)
