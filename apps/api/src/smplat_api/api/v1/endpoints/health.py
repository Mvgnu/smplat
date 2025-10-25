from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz", summary="Service health check")
async def service_health() -> dict[str, str]:
    return {"status": "ok"}
