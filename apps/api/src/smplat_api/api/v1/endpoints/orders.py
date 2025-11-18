"""Order management API endpoints."""

import re
from typing import List, Dict, Any, Optional, Sequence
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from loguru import logger
from decimal import Decimal

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.order import Order, OrderItem, OrderStatusEnum, OrderSourceEnum
from smplat_api.models.order_state_event import (
    OrderStateActorTypeEnum,
    OrderStateEvent,
    OrderStateEventTypeEnum,
)
from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.services.fulfillment import FulfillmentService, ProviderAutomationService
from smplat_api.services.orders.acceptance import BundleAcceptanceService
from smplat_api.services.orders.state_machine import (
    InvalidOrderTransitionError,
    OrderStateMachine,
    OrderNotFoundError,
)
from smplat_api.schemas.fulfillment_provider import FulfillmentProviderOrderResponse
from smplat_api.services.delivery_proof import (
    DeliveryProofAggregatesEnvelope,
    OrderDeliveryProofResponse,
    fetch_delivery_proof_aggregates,
    fetch_order_delivery_proof,
)


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
    platform_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Platform metadata captured at checkout for this line item",
    )


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
    platform_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Platform metadata persisted for the order item",
    )
    customer_social_account_id: Optional[str] = Field(default=None, description="Linked social account identifier")
    baseline_metrics: Optional[Dict[str, Any]] = None
    delivery_snapshots: Optional[Dict[str, Any]] = None
    target_metrics: Optional[Dict[str, Any]] = None


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
    receipt_storage_key: Optional[str] = Field(
        default=None,
        description="Object storage key for the generated receipt PDF.",
    )
    receipt_storage_url: Optional[str] = Field(
        default=None,
        description="Public URL for the stored receipt PDF when available.",
    )
    receipt_storage_uploaded_at: Optional[str] = Field(
        default=None,
        description="Timestamp when the receipt PDF was last uploaded to storage.",
    )
    created_at: str
    updated_at: str
    items: List[OrderItemResponse]
    provider_orders: List[FulfillmentProviderOrderResponse] = Field(default_factory=list, alias="providerOrders")


class OrderStatusUpdate(BaseModel):
    """Request model for updating order status."""
    status: str = Field(..., description="New order status")
    notes: Optional[str] = Field(None, description="Status update notes")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Optional metadata recorded alongside the event.")
    actorType: Optional[str] = Field(
        default="operator",
        description="Actor classification (system|operator|admin|automation|provider).",
    )
    actorId: Optional[str] = Field(default=None, description="Optional identifier for the actor performing the update.")
    actorLabel: Optional[str] = Field(default=None, description="Human-readable actor display name.")


class OrderStateEventResponse(BaseModel):
    """Timeline entry describing a state change, refill, refund, or operator note."""

    id: str
    eventType: str = Field(..., description="Event category (state_change, refill, refund, etc.)")
    actorType: Optional[str] = None
    actorId: Optional[str] = None
    actorLabel: Optional[str] = None
    fromStatus: Optional[str] = Field(default=None, description="Previous order status value.")
    toStatus: Optional[str] = Field(default=None, description="New order status value.")
    notes: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str


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
                attributes=item_data.attributes,
                platform_context=item_data.platform_context,
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


@router.patch(
    "/{order_id}/status",
    response_model=OrderResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
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
        try:
            new_status = OrderStatusEnum(status_update.status.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status_update.status}",
            )

        actor_type = _parse_actor_type(status_update.actorType)
        metadata = status_update.metadata or {}
        state_machine = OrderStateMachine(db)
        note_text = status_update.notes.strip() if isinstance(status_update.notes, str) else None
        if note_text:
            await db.execute(
                update(Order)
                    .where(Order.id == order_id)
                    .values(notes=note_text)
            )

        try:
            await state_machine.transition(
                order_id=order_id,
                target_status=new_status,
                actor_type=actor_type,
                actor_id=status_update.actorId,
                actor_label=status_update.actorLabel,
                notes=status_update.notes,
                metadata=metadata,
            )
        except OrderNotFoundError:
            raise HTTPException(status_code=404, detail="Order not found")
        except InvalidOrderTransitionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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
            "Failed to update order status",
            order_id=str(order_id),
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to update order status")


@router.get(
    "/{order_id}/state-events",
    response_model=List[OrderStateEventResponse],
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_order_state_events(
    order_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> List[OrderStateEventResponse]:
    """Return the chronological audit log for an order."""

    machine = OrderStateMachine(db)
    exists = await db.scalar(select(Order.id).where(Order.id == order_id))
    if not exists:
        raise HTTPException(status_code=404, detail="Order not found")
    events = await machine.list_events(order_id)
    return [_serialize_state_event(event) for event in events]


@router.get(
    "/{order_id}/delivery-proof",
    response_model=OrderDeliveryProofResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def get_order_delivery_proof(
    order_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> OrderDeliveryProofResponse:
    """Aggregate social account baselines + delivery snapshots for every order item."""

    proof = await fetch_order_delivery_proof(db, order_id)
    if not proof:
        raise HTTPException(status_code=404, detail="Order not found")

    return proof


@router.get(
    "/delivery-proof/metrics",
    response_model=DeliveryProofAggregatesEnvelope,
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_delivery_proof_metrics(
    db: AsyncSession = Depends(get_session),
    product_ids: List[UUID] = Query(default_factory=list, alias="productId"),
    window_days: int = Query(90, ge=1, le=365, alias="windowDays"),
    limit_per_product: int = Query(50, ge=1, le=250, alias="limitPerProduct"),
) -> DeliveryProofAggregatesEnvelope:
    """Aggregate delivery proof metrics per product for storefront trust surfacing."""

    return await fetch_delivery_proof_aggregates(
        db,
        product_ids=product_ids or None,
        window_days=window_days,
        limit_per_product=limit_per_product,
    )


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
        receipt_storage_key=order.receipt_storage_key,
        receipt_storage_url=order.receipt_storage_url,
        receipt_storage_uploaded_at=order.receipt_storage_uploaded_at.isoformat()
        if order.receipt_storage_uploaded_at
        else None,
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
                attributes=item.attributes,
                platform_context=item.platform_context,
                customer_social_account_id=str(item.customer_social_account_id) if item.customer_social_account_id else None,
                baseline_metrics=item.baseline_metrics if isinstance(item.baseline_metrics, dict) else None,
                delivery_snapshots=item.delivery_snapshots if isinstance(item.delivery_snapshots, dict) else None,
                target_metrics=item.target_metrics if isinstance(item.target_metrics, dict) else None,
            )
            for item in order.items
        ],
        provider_orders=provider_entries,
    )


def _parse_actor_type(value: str | None) -> OrderStateActorTypeEnum | None:
    if not value:
        return None
    try:
        return OrderStateActorTypeEnum(value.lower())
    except ValueError:
        return None


def _serialize_state_event(event: OrderStateEvent) -> OrderStateEventResponse:
    return OrderStateEventResponse(
        id=str(event.id),
        eventType=event.event_type.value,
        actorType=event.actor_type.value if event.actor_type else None,
        actorId=event.actor_id,
        actorLabel=event.actor_label,
        fromStatus=event.from_status,
        toStatus=event.to_status,
        notes=event.notes,
        metadata=event.metadata_json if isinstance(event.metadata_json, dict) else {},
        createdAt=event.created_at.isoformat(),
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
