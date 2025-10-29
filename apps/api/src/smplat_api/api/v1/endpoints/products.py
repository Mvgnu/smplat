from uuid import UUID

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from smplat_api.db.session import get_session
from smplat_api.schemas.product import (
    ProductAssetCreate,
    ProductCreate,
    ProductDetailResponse,
    ProductAuditLogEntry,
    ProductMediaAssetResponse,
    ProductResponse,
    ProductUpdate,
)
from smplat_api.services.products import ProductService

router = APIRouter(prefix="/products", tags=["Products"])


async def get_product_service(session=Depends(get_session)) -> ProductService:
    return ProductService(session)


@router.get("/", summary="List products", response_model=list[ProductResponse])
async def list_products(service: ProductService = Depends(get_product_service)) -> list[ProductResponse]:
    products = await service.list_products()
    return [ProductResponse.model_validate(product) for product in products]


@router.get("/{slug}", summary="Get product by slug", response_model=ProductDetailResponse)
async def get_product(slug: str, service: ProductService = Depends(get_product_service)) -> ProductDetailResponse:
    product = await service.get_product_by_slug(slug)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return ProductDetailResponse.model_validate(product)


@router.post("/", summary="Create product", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(payload: ProductCreate, service: ProductService = Depends(get_product_service)) -> ProductResponse:
    try:
        product = await service.create_product(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProductResponse.model_validate(product)


@router.patch("/{product_id}", summary="Update product", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    service: ProductService = Depends(get_product_service)
) -> ProductResponse:
    product = await service.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    updated = await service.update_product(product, payload)
    return ProductResponse.model_validate(updated)


@router.delete("/{product_id}", summary="Delete product", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, service: ProductService = Depends(get_product_service)) -> None:
    product = await service.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    await service.delete_product(product_id)


@router.post(
    "/{product_id}/assets",
    summary="Attach media asset",
    response_model=ProductMediaAssetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def attach_asset(
    product_id: UUID,
    payload: ProductAssetCreate,
    service: ProductService = Depends(get_product_service),
) -> ProductMediaAssetResponse:
    product = await service.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    asset = await service.attach_media_asset(
        product,
        label=payload.label,
        asset_url=payload.asset_url,
        storage_key=payload.storage_key,
        metadata=payload.metadata,
    )
    return ProductMediaAssetResponse.model_validate(asset)


@router.delete("/assets/{asset_id}", summary="Remove media asset", status_code=status.HTTP_204_NO_CONTENT)
async def remove_asset(asset_id: UUID, service: ProductService = Depends(get_product_service)) -> None:
    await service.remove_media_asset(asset_id)


@router.get(
    "/{product_id}/audit",
    summary="List product audit log",
    response_model=list[ProductAuditLogEntry],
)
async def list_audit_log(
    product_id: UUID, service: ProductService = Depends(get_product_service)
) -> list[ProductAuditLogEntry]:
    product = await service.get_product_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    logs = await service.list_audit_logs(product_id)
    return [ProductAuditLogEntry.model_validate(entry) for entry in logs]


@router.post(
    "/audit/{log_id}/restore",
    summary="Restore product state from audit entry",
    response_model=ProductDetailResponse,
)
async def restore_product(log_id: UUID, service: ProductService = Depends(get_product_service)) -> ProductDetailResponse:
    restored = await service.restore_from_audit(log_id)
    if not restored:
        raise HTTPException(status_code=404, detail="Audit log not found or cannot restore")
    return ProductDetailResponse.model_validate(restored)
