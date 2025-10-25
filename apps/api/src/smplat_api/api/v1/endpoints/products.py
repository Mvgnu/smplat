from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from smplat_api.db.session import get_session
from smplat_api.schemas.product import ProductCreate, ProductDetailResponse, ProductResponse, ProductUpdate
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
