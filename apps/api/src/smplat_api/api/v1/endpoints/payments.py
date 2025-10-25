import stripe
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.observability.payments import get_payment_store
from smplat_api.services.payments.payment_service import PaymentService
from smplat_api.services.payments.stripe_service import StripeService


router = APIRouter(prefix="/payments", tags=["payments"])


class CheckoutRequest(BaseModel):
    """Request model for creating checkout session."""
    order_id: UUID = Field(..., description="Order ID for payment")
    success_url: str = Field(..., description="URL to redirect after successful payment")
    cancel_url: str = Field(..., description="URL to redirect after cancelled payment")
    customer_email: str | None = Field(None, description="Customer email for prefilling")


class CheckoutResponse(BaseModel):
    """Response model for checkout session creation."""
    checkout_session_id: str = Field(..., description="Stripe checkout session ID")
    checkout_url: str = Field(..., description="URL to redirect user for payment")
    payment_id: str = Field(..., description="Internal payment record ID")
    amount: float = Field(..., description="Payment amount")
    currency: str = Field(..., description="Payment currency")


class WebhookResponse(BaseModel):
    """Response model for webhook processing."""
    success: bool = Field(..., description="Whether webhook was processed successfully")
    message: str = Field(..., description="Processing result message")


@router.post(
    "/checkout",
    response_model=CheckoutResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_checkout_session(
    request: CheckoutRequest,
    db: AsyncSession = Depends(get_session)
) -> CheckoutResponse:
    """Create a Stripe checkout session for order payment.
    
    This endpoint creates a Stripe checkout session for the specified order,
    automatically calculating line items from the order details.
    
    Args:
        request: Checkout session creation request
        db: Database session
        
    Returns:
        Checkout session details including payment URL
        
    Raises:
        HTTPException: If order not found or checkout creation fails
    """
    try:
        payment_service = PaymentService(db)
        payments_store = get_payment_store()
        
        # Get order details to create line items
        from smplat_api.models.order import Order
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        
        stmt = select(Order).options(selectinload(Order.items)).where(Order.id == request.order_id)
        result = await db.execute(stmt)
        order = result.scalar_one_or_none()
        
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
            
        # Create Stripe line items from order items
        line_items = []
        for item in order.items:
            unit_price = Decimal(item.unit_price)
            unit_amount_cents = int((unit_price * 100).to_integral_value(rounding=ROUND_HALF_UP))

            line_items.append({
                "price_data": {
                    "currency": order.currency.value.lower(),
                    "unit_amount": unit_amount_cents,
                    "product_data": {
                        "name": item.product_title,
                        "description": f"Social media service - {item.product_title}"
                    }
                },
                "quantity": item.quantity
            })
            
        if not line_items:
            raise HTTPException(status_code=400, detail="Order has no items")
            
        # Create checkout session
        checkout_data = await payment_service.initiate_stripe_checkout(
            order_id=request.order_id,
            line_items=line_items,
            customer_email=request.customer_email,
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata={"order_number": order.order_number}
        )

        payments_store.record_checkout_success(checkout_data.get("payment_id"))
        return CheckoutResponse(**checkout_data)
        
    except HTTPException:
        raise
    except Exception as e:
        get_payment_store().record_checkout_failure(str(e))
        logger.error(
            "Failed to create checkout session",
            order_id=str(request.order_id),
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@router.post("/webhooks/stripe", response_model=WebhookResponse)
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="stripe-signature"),
    db: AsyncSession = Depends(get_session)
) -> WebhookResponse:
    """Handle Stripe webhook events for payment processing.
    
    This endpoint receives and processes Stripe webhook events,
    updating payment and order statuses accordingly.
    
    Args:
        request: FastAPI request object containing webhook payload
        stripe_signature: Stripe signature header for verification
        db: Database session
        
    Returns:
        Webhook processing result
        
    Raises:
        HTTPException: If webhook verification fails or processing error occurs
    """
    delivery_id = request.headers.get("stripe-webhook-id")
    retry_count = request.headers.get("stripe-webhook-retry-count", "0")
    event: Dict[str, Any] | None = None
    payments_store = get_payment_store()

    try:
        payload = await request.body()

        stripe_service = StripeService()
        event = await stripe_service.construct_webhook_event(payload, stripe_signature)

        logger.info(
            "Processing Stripe webhook event",
            event_id=event.get("id"),
            event_type=event.get("type"),
            delivery_id=delivery_id,
            retry_count=retry_count,
            livemode=event.get("livemode"),
        )

        payment_service = PaymentService(db)
        success = await payment_service.process_stripe_webhook_event(event)

    except stripe.SignatureVerificationError:
        logger.warning(
            "Invalid Stripe webhook signature",
            delivery_id=delivery_id,
            retry_count=retry_count,
        )
        payments_store.record_webhook(
            event_type=event["type"] if event else "signature_error",
            success=False,
            delivery_id=delivery_id,
            error="signature_verification_failed",
        )
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except Exception as e:
        logger.error(
            "Stripe webhook processing error",
            error=str(e),
            delivery_id=delivery_id,
            retry_count=retry_count,
            event_id=event.get("id") if event else None,
            event_type=event.get("type") if event else None,
        )
        payments_store.record_webhook(
            event_type=event["type"] if event else "unknown",
            success=False,
            delivery_id=delivery_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Webhook processing failed")

    if success:
        logger.info(
            "Stripe webhook processed successfully",
            event_id=event.get("id"),
            event_type=event.get("type"),
            delivery_id=delivery_id,
            retry_count=retry_count,
        )
        payments_store.record_webhook(
            event_type=event.get("type", "unknown"),
            success=True,
            delivery_id=delivery_id,
            error=None,
        )
        return WebhookResponse(
            success=True,
            message=f"Successfully processed {event['type']} event",
        )

    logger.error(
        "Stripe webhook handler reported failure; requesting retry",
        event_id=event.get("id"),
        event_type=event.get("type"),
        delivery_id=delivery_id,
        retry_count=retry_count,
    )
    payments_store.record_webhook(
        event_type=event.get("type", "unknown"),
        success=False,
        delivery_id=delivery_id,
        error="handler_reported_failure",
    )
    raise HTTPException(status_code=500, detail="Webhook processing failed")


@router.get("/status/{payment_id}", dependencies=[Depends(require_checkout_api_key)])
async def get_payment_status(
    payment_id: UUID,
    db: AsyncSession = Depends(get_session)
) -> Dict[str, Any]:
    """Get payment status by payment ID.
    
    Args:
        payment_id: Payment record ID
        db: Database session
        
    Returns:
        Payment status information
        
    Raises:
        HTTPException: If payment not found
    """
    try:
        from smplat_api.models.payment import Payment
        from sqlalchemy import select
        
        stmt = select(Payment).where(Payment.id == payment_id)
        result = await db.execute(stmt)
        payment = result.scalar_one_or_none()
        
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
            
        return {
            "payment_id": str(payment.id),
            "status": payment.status.value,
            "amount": float(payment.amount),
            "currency": payment.currency.value,
            "provider": payment.provider.value,
            "provider_reference": payment.provider_reference,
            "failure_reason": payment.failure_reason,
            "created_at": payment.created_at.isoformat(),
            "captured_at": payment.captured_at.isoformat() if payment.captured_at else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get payment status",
            payment_id=str(payment_id),
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve payment status")


@router.get("/observability", dependencies=[Depends(require_checkout_api_key)])
async def get_payments_observability() -> Dict[str, Any]:
    """Return aggregated observability metrics for checkout + webhook flows."""
    store = get_payment_store()
    return store.snapshot().as_dict()
