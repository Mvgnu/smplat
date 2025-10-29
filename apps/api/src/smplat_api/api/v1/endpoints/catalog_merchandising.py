from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from smplat_api.db.session import get_session
from smplat_api.schemas.catalog import (
    CatalogBundleCreate,
    CatalogBundleResponse,
    CatalogBundleUpdate,
)
from smplat_api.services.catalog.merchandising import CatalogBundleService

router = APIRouter(prefix="/catalog/bundles", tags=["Catalog Bundles"])


# meta: route: catalog/bundles


async def get_bundle_service(session=Depends(get_session)) -> CatalogBundleService:
    return CatalogBundleService(session)


@router.get("/", summary="List catalog bundles", response_model=list[CatalogBundleResponse])
async def list_bundles(
    service: CatalogBundleService = Depends(get_bundle_service),
) -> list[CatalogBundleResponse]:
    bundles = await service.list_bundles()
    return [CatalogBundleResponse.model_validate(bundle) for bundle in bundles]


@router.get(
    "/product/{primary_slug}",
    summary="List bundles for a primary product",
    response_model=list[CatalogBundleResponse],
)
async def list_bundles_for_product(
    primary_slug: str, service: CatalogBundleService = Depends(get_bundle_service)
) -> list[CatalogBundleResponse]:
    bundles = await service.list_for_product(primary_slug)
    return [CatalogBundleResponse.model_validate(bundle) for bundle in bundles]


@router.get("/{bundle_slug}", summary="Get bundle by slug", response_model=CatalogBundleResponse)
async def get_bundle(
    bundle_slug: str, service: CatalogBundleService = Depends(get_bundle_service)
) -> CatalogBundleResponse:
    bundle = await service.get_by_slug(bundle_slug)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return CatalogBundleResponse.model_validate(bundle)


@router.post(
    "/",
    summary="Create catalog bundle",
    response_model=CatalogBundleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_bundle(
    payload: CatalogBundleCreate, service: CatalogBundleService = Depends(get_bundle_service)
) -> CatalogBundleResponse:
    try:
        bundle = await service.create_bundle(
            primary_product_slug=payload.primary_product_slug,
            bundle_slug=payload.bundle_slug,
            title=payload.title,
            description=payload.description,
            savings_copy=payload.savings_copy,
            cms_priority=payload.cms_priority,
            components=[component.model_dump() for component in payload.components],
            metadata=payload.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CatalogBundleResponse.model_validate(bundle)


@router.patch(
    "/{bundle_id}",
    summary="Update catalog bundle",
    response_model=CatalogBundleResponse,
)
async def update_bundle(
    bundle_id: UUID,
    payload: CatalogBundleUpdate,
    service: CatalogBundleService = Depends(get_bundle_service),
) -> CatalogBundleResponse:
    bundle = await service.get_by_id(bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    updated = await service.update_bundle(
        bundle,
        title=payload.title,
        description=payload.description,
        savings_copy=payload.savings_copy,
        cms_priority=payload.cms_priority,
        components=[component.model_dump() for component in payload.components]
        if payload.components is not None
        else None,
        metadata=payload.metadata,
    )
    return CatalogBundleResponse.model_validate(updated)


@router.delete(
    "/{bundle_id}", summary="Delete catalog bundle", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_bundle(
    bundle_id: UUID, service: CatalogBundleService = Depends(get_bundle_service)
) -> None:
    bundle = await service.get_by_id(bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    await service.delete_bundle(bundle)
