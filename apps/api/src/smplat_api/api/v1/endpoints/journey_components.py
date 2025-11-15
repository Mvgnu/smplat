from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from smplat_api.db.session import get_session
from smplat_api.schemas.product import (
    JourneyComponentCreate,
    JourneyComponentDefinition,
    JourneyComponentRunCreate,
    JourneyComponentRunResponse,
    JourneyComponentUpdate,
)
from smplat_api.services.journey_components import JourneyComponentService
from smplat_api.services.journey_runtime import JourneyRuntimeService

router = APIRouter(prefix="/journey-components", tags=["Journey Components"])


async def get_journey_component_service(
    session=Depends(get_session),
) -> JourneyComponentService:
    return JourneyComponentService(session)


async def get_journey_runtime_service(
    session=Depends(get_session),
) -> JourneyRuntimeService:
    return JourneyRuntimeService(session)


@router.get(
    "",
    summary="List journey components",
    response_model=list[JourneyComponentDefinition],
)
async def list_journey_components(
    service: JourneyComponentService = Depends(get_journey_component_service),
) -> list[JourneyComponentDefinition]:
    components = await service.list_components()
    return [JourneyComponentDefinition.model_validate(component) for component in components]


@router.post(
    "",
    summary="Create journey component",
    response_model=JourneyComponentDefinition,
    status_code=status.HTTP_201_CREATED,
)
async def create_journey_component(
    payload: JourneyComponentCreate,
    service: JourneyComponentService = Depends(get_journey_component_service),
) -> JourneyComponentDefinition:
    try:
        component = await service.create_component(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return JourneyComponentDefinition.model_validate(component)


@router.post(
    "/run",
    summary="Enqueue a journey component run",
    response_model=JourneyComponentRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def enqueue_journey_component_run(
    payload: JourneyComponentRunCreate,
    runtime_service: JourneyRuntimeService = Depends(get_journey_runtime_service),
) -> JourneyComponentRunResponse:
    try:
        run = await runtime_service.create_run(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return JourneyComponentRunResponse.model_validate(run)


@router.get(
    "/{component_id}",
    summary="Fetch journey component",
    response_model=JourneyComponentDefinition,
)
async def fetch_journey_component(
    component_id: UUID,
    service: JourneyComponentService = Depends(get_journey_component_service),
) -> JourneyComponentDefinition:
    component = await service.get_component_by_id(component_id)
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey component not found")
    return JourneyComponentDefinition.model_validate(component)


@router.patch(
    "/{component_id}",
    summary="Update journey component",
    response_model=JourneyComponentDefinition,
)
async def update_journey_component(
    component_id: UUID,
    payload: JourneyComponentUpdate,
    service: JourneyComponentService = Depends(get_journey_component_service),
) -> JourneyComponentDefinition:
    component = await service.get_component_by_id(component_id)
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey component not found")

    try:
        updated = await service.update_component(component, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return JourneyComponentDefinition.model_validate(updated)


@router.delete(
    "/{component_id}",
    summary="Delete journey component",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_journey_component(
    component_id: UUID,
    service: JourneyComponentService = Depends(get_journey_component_service),
) -> None:
    component = await service.get_component_by_id(component_id)
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey component not found")
    await service.delete_component(component)

