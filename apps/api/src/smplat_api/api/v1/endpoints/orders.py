"""Order management API endpoints."""

import re
from typing import List, Dict, Any, Optional, Sequence
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from loguru import logger
from decimal import Decimal

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.order import Order, OrderItem, OrderStatusEnum, OrderSourceEnum
from smplat_api.models.product import Product
from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.services.fulfillment import FulfillmentService, ProviderAutomationService
from smplat_api.services.orders.acceptance import BundleAcceptanceService
from smplat_api.schemas.fulfillment_provider import FulfillmentProviderOrderResponse


router = APIRouter(prefix="/orders", tags=["orders"])


class OrderItemCreate(BaseModel):
    """Request model for creating order items."""
    product_id: UUID = Field(..., description="Product ID")
    product_title: str = Field(..., description="Product title snapshot")
    quantity: int = Field(1, ge=1, description="Item quantity")
    unit_price: Decimal = Field(..., ge=0, description="Unit price")
    total_price: Decimal = Field(..., ge=0, description="Total item price")
    selected_options: Optional[Dict[str, Any]] = Field(None, description="Selected product options")
    attributes: Optional[Dict[str, Any]] = Field(None, description="Additional item attributes")


class OrderCreate(BaseModel):
    """Request model for creating orders."""
    items: List[OrderItemCreate] = Field(..., min_length=1, description="Order items")
    currency: str = Field("EUR", description="Order currency")
    source: str = Field("checkout", description="Order source")
    user_id: Optional[UUID] = Field(None, description="User ID (optional for guest checkout)")
    notes: Optional[str] = Field(None, description="Order notes")
    loyalty_projection_points: Optional[int] = Field(
        None,
        description="Projected loyalty points for the order (structured value preferred over notes)",
    )


class OrderItemResponse(BaseModel):
    """Response model for order items."""
    id: str
    product_id: Optional[str]
    product_title: str
    quantity: int
    unit_price: float
    total_price: float
    selected_options: Optional[Dict[str, Any]]
    attributes: Optional[Dict[str, Any]]


class OrderResponse(BaseModel):
    """Response model for orders."""
    id: str
    order_number: str
    user_id: Optional[str]
    status: str
    source: str
    subtotal: float
    tax: float
    total: float
    currency: str
    notes: Optional[str]
    loyalty_projection_points: Optional[int] = Field(
        None, description="Projected loyalty points for this order"
    )
    created_at: str
    updated_at: str
    items: List[OrderItemResponse]
    provider_orders: List[FulfillmentProviderOrderResponse] = Field(default_factory=list, alias="providerOrders")


class OrderStatusUpdate(BaseModel):
    """Request model for updating order status."""
    status: str = Field(..., description="New order status")
    notes: Optional[str] = Field(None, description="Status update notes")


@router.post(
    "/",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_order(
    order_data: OrderCreate,
    db: AsyncSession = Depends(get_session)
) -> OrderResponse:
    """Create a new order with items.
    
    This endpoint creates a complete order with associated items,
    calculating totals and generating a unique order number.
    
    Args:
        order_data: Order creation request data
        db: Database session
        
    Returns:
        Created order with items
        
    Raises:
        HTTPException: If validation fails or creation error occurs
    """
    try:
        # Validate currency
        try:
            currency_enum = CurrencyEnum(order_data.currency.upper())
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid currency: {order_data.currency}"
            )
            
        # Validate order source
        try:
            source_enum = OrderSourceEnum(order_data.source.lower())
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid order source: {order_data.source}"
            )
        
        # Calculate order totals
        subtotal = sum(item.total_price for item in order_data.items)
        tax = Decimal("0")  # Tax calculation can be added later
        total = subtotal + tax
        
        # Generate unique order number
        order_count = await db.scalar(select(func.count(Order.id)))
        order_number = f"SM{(order_count or 0) + 1:06d}"
        
        loyalty_projection_points = order_data.loyalty_projection_points
        if loyalty_projection_points is None and order_data.notes:
            loyalty_projection_points = _extract_loyalty_projection_points(order_data.notes)

        order = Order(
            order_number=order_number,
            user_id=order_data.user_id,
            status=OrderStatusEnum.PENDING,
            source=source_enum,
            subtotal=subtotal,
            tax=tax,
            total=total,
            currency=currency_enum,
            notes=order_data.notes,
            loyalty_projection_points=loyalty_projection_points,
        )
        
        db.add(order)
        await db.flush()  # Get order ID for items
        
        tracked_product_slugs: list[str] = []

        # Create order items
        for item_data in order_data.items:
            # Verify product exists
            product_stmt = select(Product).where(Product.id == item_data.product_id)
            product_result = await db.execute(product_stmt)
            product = product_result.scalar_one_or_none()
            
            if not product:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {item_data.product_id}"
                )

            if product.slug:
                tracked_product_slugs.append(product.slug)

            order_item = OrderItem(
                order_id=order.id,
                product_id=item_data.product_id,
                product_title=item_data.product_title,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                total_price=item_data.total_price,
                selected_options=item_data.selected_options,
                attributes=item_data.attributes
            )

            db.add(order_item)

        if tracked_product_slugs:
            acceptance_service = BundleAcceptanceService(db)
            await acceptance_service.record_order_acceptance(tracked_product_slugs)

        await db.commit()
        await db.refresh(order)
        
        # Fetch order with items for response
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.provider_orders))
            .where(Order.id == order.id)
        )
        result = await db.execute(stmt)
        created_order = result.scalar_one()
        
        logger.info(
            "Created order",
            order_id=str(created_order.id),
            order_number=created_order.order_number,
            total=float(created_order.total),
            items_count=len(created_order.items)
        )
        
        automation = ProviderAutomationService(db)
        provider_orders = await automation.list_orders_for_order(created_order.id)
        return _order_to_response(created_order, provider_orders=provider_orders)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to create order",
            error=str(e),
            order_data=order_data.model_dump()
        )
        await db.rollback()
        raise HTTPException(
            status_code=500, 
            detail="Failed to create order"
        )


@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_session)
) -> OrderResponse:
    """Get order details by ID.
    
    Args:
        order_id: Order ID
        db: Database session
        
    Returns:
        Order details with items
        
    Raises:
        HTTPException: If order not found
    """
    try:
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.provider_orders))
            .where(Order.id == order_id)
        )
        result = await db.execute(stmt)
        order = result.scalar_one_or_none()
        
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        automation = ProviderAutomationService(db)
        provider_orders = await automation.list_orders_for_order(order.id)
        return _order_to_response(order, provider_orders=provider_orders)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get order",
            order_id=str(order_id),
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve order")


@router.get("/", response_model=List[OrderResponse])
async def list_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[str] = None,
    db: AsyncSession = Depends(get_session)
) -> List[OrderResponse]:
    """List orders with optional filtering.
    
    Args:
        skip: Number of orders to skip
        limit: Maximum number of orders to return
        status_filter: Optional status filter
        db: Database session
        
    Returns:
        List of orders
    """
    try:
        stmt = select(Order).options(selectinload(Order.items).selectinload(OrderItem.provider_orders))
        
        if status_filter:
            try:
                status_enum = OrderStatusEnum(status_filter.lower())
                stmt = stmt.where(Order.status == status_enum)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid status filter: {status_filter}"
                )
        
        stmt = stmt.offset(skip).limit(limit).order_by(Order.created_at.desc())
        
        result = await db.execute(stmt)
        orders = result.scalars().all()

        automation = ProviderAutomationService(db)
        provider_orders_map = await automation.list_orders_for_orders([order.id for order in orders])
        return [_order_to_response(order, provider_orders=provider_orders_map.get(order.id)) for order in orders]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to list orders",
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to list orders")


@router.get(
    "/user/{user_id}",
    response_model=List[OrderResponse],
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_orders_for_user(
    user_id: UUID,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_session),
) -> List[OrderResponse]:
    """List orders for a specific user (secured by checkout API key)."""
    try:
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.provider_orders))
            .where(Order.user_id == user_id)
            .offset(skip)
            .limit(limit)
            .order_by(Order.created_at.desc())
        )

        result = await db.execute(stmt)
        orders = result.scalars().all()

        automation = ProviderAutomationService(db)
        provider_orders_map = await automation.list_orders_for_orders([order.id for order in orders])
        return [_order_to_response(order, provider_orders=provider_orders_map.get(order.id)) for order in orders]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to list orders for user",
            user_id=str(user_id),
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to list orders for user")


@router.patch("/{order_id}/status", response_model=OrderResponse)
async def update_order_status(
    order_id: UUID,
    status_update: OrderStatusUpdate,
    db: AsyncSession = Depends(get_session)
) -> OrderResponse:
    """Update order status.
    
    Args:
        order_id: Order ID
        status_update: Status update data
        db: Database session
        
    Returns:
        Updated order
        
    Raises:
        HTTPException: If order not found or invalid status
    """
    try:
        # Validate status
        try:
            new_status = OrderStatusEnum(status_update.status.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status_update.status}"
            )
        
        stmt = (
            select(Order)
            .options(selectinload(Order.items).selectinload(OrderItem.provider_orders))
            .where(Order.id == order_id)
        )
        result = await db.execute(stmt)
        order = result.scalar_one_or_none()
        
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        # Update order
        order.status = new_status
        if status_update.notes:
            order.notes = status_update.notes
            
        await db.commit()
        await db.refresh(order)
        
        logger.info(
            "Updated order status",
            order_id=str(order_id),
            old_status=order.status.value,
            new_status=new_status.value
        )
        
        automation = ProviderAutomationService(db)
        provider_orders = await automation.list_orders_for_order(order.id)
        return _order_to_response(order, provider_orders=provider_orders)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to update order status",
            order_id=str(order_id),
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to update order status")


def _order_to_response(
    order: Order,
    *,
    provider_orders: Sequence[FulfillmentProviderOrder] | None = None,
) -> OrderResponse:
    """Convert Order model to response format.
    
    Args:
        order: Order model instance
        
    Returns:
        OrderResponse object
    """
    provider_entries: List[FulfillmentProviderOrderResponse] = []
    seen: set[str] = set()
    source = provider_orders or []
    for provider_order in source:
        provider_order_id = getattr(provider_order, "id", None)
        key = str(provider_order_id) if provider_order_id is not None else None
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        provider_entries.append(FulfillmentProviderOrderResponse.model_validate(provider_order))

    return OrderResponse(
        id=str(order.id),
        order_number=order.order_number,
        user_id=str(order.user_id) if order.user_id else None,
        status=order.status.value,
        source=order.source.value,
        subtotal=float(order.subtotal),
        tax=float(order.tax),
        total=float(order.total),
        currency=order.currency.value,
        notes=order.notes,
        loyalty_projection_points=order.loyalty_projection_points,
        created_at=order.created_at.isoformat(),
        updated_at=order.updated_at.isoformat(),
        items=[
            OrderItemResponse(
                id=str(item.id),
                product_id=str(item.product_id) if item.product_id else None,
                product_title=item.product_title,
                quantity=item.quantity,
                unit_price=float(item.unit_price),
                total_price=float(item.total_price),
                selected_options=item.selected_options,
                attributes=item.attributes
            )
            for item in order.items
        ],
        provider_orders=provider_entries,
    )


_LOYALTY_NOTE_REGEX = re.compile(r"loyaltyProjection=(\d+)", re.IGNORECASE)


def _extract_loyalty_projection_points(notes: Optional[str]) -> Optional[int]:
    """Parse loyalty projection from order notes for backward compatibility."""
    if not notes:
        return None
    match = _LOYALTY_NOTE_REGEX.search(notes)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None




@router.get(
    "/{order_id}/progress",
    dependencies=[Depends(require_checkout_api_key)],
)
async def get_order_progress(
    order_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> Dict[str, Any]:
    """Return fulfillment progress rollup for an order."""
    service = FulfillmentService(db)
    progress = await service.get_order_fulfillment_progress(order_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return progress
