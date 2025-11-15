from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.services.reporting import BlueprintMetricsService

router = APIRouter(
    prefix="/reporting",
    tags=["Reporting"],
    dependencies=[Depends(require_checkout_api_key)],
)


@router.get(
    "/blueprint-metrics",
    summary="Blueprint adoption and provider engagement metrics",
)
async def get_blueprint_metrics(
    window_days: int = Query(30, ge=1, le=365, description="Lookback window in days"),
    option_limit: int = Query(50, ge=1, le=250),
    add_on_limit: int = Query(50, ge=1, le=250),
    provider_limit: int = Query(50, ge=1, le=250),
    preset_limit: int = Query(50, ge=1, le=250),
    session=Depends(get_session),
):
    service = BlueprintMetricsService(session)
    return await service.fetch_metrics(
        window_days=window_days,
        option_limit=option_limit,
        add_on_limit=add_on_limit,
        provider_limit=provider_limit,
        preset_limit=preset_limit,
    )
