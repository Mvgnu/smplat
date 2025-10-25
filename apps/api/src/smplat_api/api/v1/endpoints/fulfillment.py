from fastapi import APIRouter, HTTPException, Request

from smplat_api.observability.fulfillment import get_fulfillment_store

router = APIRouter()


def _get_processor(request: Request):
    processor = getattr(request.app.state, "fulfillment_processor", None)
    if processor is None:
        raise HTTPException(status_code=503, detail="Fulfillment processor unavailable")
    return processor


@router.get("/fulfillment/metrics", summary="Fulfillment processor metrics")
async def fulfillment_metrics(request: Request) -> dict[str, object]:
    processor = _get_processor(request)
    return processor.metrics.snapshot()


@router.get("/fulfillment/health", summary="Fulfillment processor health")
async def fulfillment_health(request: Request) -> dict[str, object]:
    processor = _get_processor(request)
    return processor.health_snapshot()


@router.get("/fulfillment/observability", summary="Fulfillment observability snapshot")
async def fulfillment_observability() -> dict[str, object]:
    """Return aggregated fulfillment metrics suitable for dashboards/alerts."""
    store = get_fulfillment_store()
    snapshot = store.snapshot()
    return snapshot.as_dict()
