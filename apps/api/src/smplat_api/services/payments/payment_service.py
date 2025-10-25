"""Payment processing service layer."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.order import Order, OrderStatusEnum
from smplat_api.models.payment import Payment, PaymentProviderEnum, PaymentStatusEnum
from smplat_api.models.webhook_event import WebhookEvent, WebhookProviderEnum
from smplat_api.services.fulfillment import FulfillmentService
from smplat_api.services.notifications import NotificationService
from .stripe_service import StripeService


class PaymentService:
    """Service for managing payment operations and database interactions."""
    
    def __init__(self, db_session: AsyncSession):
        """Initialize payment service.
        
        Args:
            db_session: Database session for operations
        """
        self.db = db_session
        self.stripe_service = StripeService()
        self._fulfillment_service: FulfillmentService | None = None
        self._notification_service: NotificationService | None = None
    
    def _get_fulfillment_service(self) -> FulfillmentService:
        """Lazy-load fulfillment service to avoid circular imports at module load."""
        if self._fulfillment_service is None:
            self._fulfillment_service = FulfillmentService(self.db)
        return self._fulfillment_service

    def _get_notification_service(self) -> NotificationService:
        if self._notification_service is None:
            self._notification_service = NotificationService(self.db)
        return self._notification_service

    async def _is_duplicate_webhook(self, provider_reference: str) -> bool:
        stmt = (
            select(WebhookEvent)
            .where(
                WebhookEvent.provider == WebhookProviderEnum.STRIPE,
                WebhookEvent.external_id == provider_reference,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def _record_webhook(self, provider_reference: str, event_type: str) -> None:
        event = WebhookEvent(
            provider=WebhookProviderEnum.STRIPE,
            external_id=provider_reference,
            event_type=event_type,
        )
        self.db.add(event)
        await self.db.flush()
        
    async def create_payment_record(
        self,
        order_id: UUID,
        provider_reference: str,
        amount: Decimal,
        currency: CurrencyEnum = CurrencyEnum.EUR,
        provider: PaymentProviderEnum = PaymentProviderEnum.STRIPE,
        status: PaymentStatusEnum = PaymentStatusEnum.PENDING
    ) -> Payment:
        """Create a new payment record in the database.
        
        Args:
            order_id: Associated order ID
            provider_reference: Payment provider's reference ID
            amount: Payment amount
            currency: Payment currency
            provider: Payment provider
            status: Initial payment status
            
        Returns:
            Created payment record
        """
        if not isinstance(amount, Decimal):
            amount = Decimal(str(amount))
        
        payment = Payment(
            order_id=order_id,
            provider_reference=provider_reference,
            amount=amount,
            currency=currency,
            provider=provider,
            status=status
        )
        
        self.db.add(payment)
        await self.db.commit()
        await self.db.refresh(payment)
        
        logger.info(
            "Created payment record",
            payment_id=str(payment.id),
            order_id=str(order_id),
            amount=float(amount),
            currency=currency.value,
            provider=provider.value
        )
        
        return payment
        
    async def update_payment_status(
        self,
        provider_reference: str,
        status: PaymentStatusEnum,
        failure_reason: Optional[str] = None,
        captured_at: Optional[Any] = None
    ) -> Optional[Payment]:
        """Update payment status by provider reference.
        
        Args:
            provider_reference: Payment provider's reference ID
            status: New payment status
            failure_reason: Reason for failure (if applicable)
            captured_at: Timestamp when payment was captured
            
        Returns:
            Updated payment record or None if not found
        """
        stmt = select(Payment).where(Payment.provider_reference == provider_reference)
        result = await self.db.execute(stmt)
        payment = result.scalar_one_or_none()
        
        if not payment:
            logger.warning(
                "Payment not found for status update",
                provider_reference=provider_reference
            )
            return None
        
        previous_status = payment.status
        order_id: UUID | None = payment.order_id
        
        if failure_reason:
            payment.failure_reason = failure_reason
        if captured_at and isinstance(captured_at, datetime):
            payment.captured_at = captured_at

        # Short-circuit if status already matches (idempotency)
        if previous_status == status:
            await self.db.commit()
            await self.db.refresh(payment)
            logger.info(
                "Ignored duplicate payment status update",
                payment_id=str(payment.id),
                provider_reference=provider_reference,
                status=status.value
            )
            return payment

        payment.status = status

        # Update related order state when applicable
        await self.db.refresh(payment, attribute_names=["order"])
        if payment.order and status == PaymentStatusEnum.FAILED and previous_status != PaymentStatusEnum.FAILED:
            order_previous_status = payment.order.status
            await self._mark_order_on_payment_failure(
                payment.order,
                failure_reason,
                order_previous_status,
            )
            
        await self.db.commit()
        await self.db.refresh(payment)
        await self.db.refresh(payment, attribute_names=["order"])
        
        if order_id and status == PaymentStatusEnum.SUCCEEDED and previous_status != PaymentStatusEnum.SUCCEEDED:
            await self._get_notification_service().send_payment_success(payment)
            await self._start_fulfillment(order_id)
        
        logger.info(
            "Updated payment status",
            payment_id=str(payment.id),
            provider_reference=provider_reference,
            status=status.value,
            failure_reason=failure_reason
        )
        
        return payment
        
    async def get_payment_by_provider_reference(self, provider_reference: str) -> Optional[Payment]:
        """Retrieve payment by provider reference.
        
        Args:
            provider_reference: Payment provider's reference ID
            
        Returns:
            Payment record or None if not found
        """
        stmt = select(Payment).where(Payment.provider_reference == provider_reference)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
        
    async def get_payments_by_order_id(self, order_id: UUID) -> list[Payment]:
        """Retrieve all payments for an order.
        
        Args:
            order_id: Order ID
            
        Returns:
            List of payment records
        """
        stmt = select(Payment).where(Payment.order_id == order_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
        
    async def initiate_stripe_checkout(
        self,
        order_id: UUID,
        line_items: list[Dict[str, Any]],
        customer_email: Optional[str] = None,
        success_url: str = "",
        cancel_url: str = "",
        metadata: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Initiate Stripe checkout session and create payment record.
        
        Args:
            order_id: Order ID for payment
            line_items: Stripe line items for checkout
            customer_email: Customer email for prefilling
            success_url: Success redirect URL
            cancel_url: Cancel redirect URL
            metadata: Additional metadata
            
        Returns:
            Dictionary with checkout session details
            
        Raises:
            ValueError: If order not found
        """
        # Verify order exists
        stmt = select(Order).where(Order.id == order_id)
        result = await self.db.execute(stmt)
        order = result.scalar_one_or_none()
        
        if not order:
            raise ValueError(f"Order not found: {order_id}")
            
        # Create Stripe checkout session
        session = await self.stripe_service.create_checkout_session(
            order_id=str(order_id),
            line_items=line_items,
            customer_email=customer_email,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=metadata
        )
        
        # Calculate total amount from line items
        total_amount = Decimal("0")
        for item in line_items:
            price_data = item.get("price_data", {})
            unit_amount = price_data.get("unit_amount", 0)
            quantity = item.get("quantity", 1)
            total_amount += (Decimal(unit_amount) * Decimal(quantity)) / Decimal("100")  # Convert from cents
        total_amount = total_amount.quantize(Decimal("0.01"))
        
        # Create payment record
        payment = await self.create_payment_record(
            order_id=order_id,
            provider_reference=session.payment_intent,
            amount=total_amount,
            currency=order.currency,
            provider=PaymentProviderEnum.STRIPE,
            status=PaymentStatusEnum.PENDING
        )
        
        return {
            "checkout_session_id": session.id,
            "checkout_url": session.url,
            "payment_id": str(payment.id),
            "amount": float(total_amount),
            "currency": order.currency.value
        }
        
    async def process_stripe_webhook_event(self, event_data: Dict[str, Any]) -> bool:
        """Process Stripe webhook event and update payment status.

        Args:
            event_data: Stripe webhook event data

        Returns:
            True if event was processed successfully, False otherwise
        """
        event_type = event_data.get("type", "unknown")
        event_id = event_data.get("id")

        if event_id and await self._is_duplicate_webhook(event_id):
            logger.info("Ignoring duplicate Stripe webhook", event_id=event_id, event_type=event_type)
            return True

        processed = False

        if event_type == "payment_intent.succeeded":
            processed = await self._handle_payment_succeeded(event_data["data"]["object"])
        elif event_type == "payment_intent.payment_failed":
            processed = await self._handle_payment_failed(event_data["data"]["object"])
        elif event_type == "checkout.session.completed":
            processed = await self._handle_checkout_completed(event_data["data"]["object"])
        else:
            logger.info(
                "Received unhandled Stripe webhook event",
                event_type=event_type,
                event_id=event_id,
            )
            processed = True

        if processed and event_id:
            await self._record_webhook(event_id, event_type)
            await self.db.commit()

        return processed
            
    async def _handle_payment_succeeded(self, payment_intent: Dict[str, Any]) -> bool:
        """Handle successful payment intent.
        
        Args:
            payment_intent: Stripe PaymentIntent object
            
        Returns:
            True if handled successfully
        """
        try:
            captured_at = payment_intent.get("created")
            captured_at_dt: datetime | None = None
            if isinstance(captured_at, (int, float)):
                captured_at_dt = datetime.fromtimestamp(captured_at, tz=timezone.utc)
            
            payment = await self.update_payment_status(
                provider_reference=payment_intent["id"],
                status=PaymentStatusEnum.SUCCEEDED,
                captured_at=captured_at_dt
            )
            
            if payment:
                logger.info(
                    "Payment succeeded",
                    payment_id=str(payment.id),
                    provider_reference=payment_intent["id"],
                    amount=payment_intent["amount_received"] / 100
                )
                
            return True
            
        except Exception as e:
            logger.error(
                "Failed to handle payment succeeded event",
                provider_reference=payment_intent["id"],
                error=str(e)
            )
            return False
            
    async def _handle_payment_failed(self, payment_intent: Dict[str, Any]) -> bool:
        """Handle failed payment intent.
        
        Args:
            payment_intent: Stripe PaymentIntent object
            
        Returns:
            True if handled successfully
        """
        try:
            last_error = payment_intent.get("last_payment_error")
            failure_reason = last_error.get("message") if last_error else "Unknown error"
            
            payment = await self.update_payment_status(
                provider_reference=payment_intent["id"],
                status=PaymentStatusEnum.FAILED,
                failure_reason=failure_reason
            )
            
            if payment:
                logger.warning(
                    "Payment failed",
                    payment_id=str(payment.id),
                    provider_reference=payment_intent["id"],
                    failure_reason=failure_reason
                )
                
            return True
            
        except Exception as e:
            logger.error(
                "Failed to handle payment failed event",
                provider_reference=payment_intent["id"],
                error=str(e)
            )
            return False
            
    async def _handle_checkout_completed(self, session: Dict[str, Any]) -> bool:
        """Handle completed checkout session.
        
        Args:
            session: Stripe Checkout Session object
            
        Returns:
            True if handled successfully
        """
        try:
            logger.info(
                "Checkout session completed",
                session_id=session["id"],
                payment_intent=session.get("payment_intent"),
                order_id=session.get("metadata", {}).get("order_id")
            )
            
            # Additional order processing logic can be added here
            # For example, triggering fulfillment workflows
            
            return True
            
        except Exception as e:
            logger.error(
                "Failed to handle checkout completed event",
                session_id=session["id"],
                error=str(e)
            )
            return False

    async def _mark_order_on_payment_failure(
        self,
        order: Order,
        reason: Optional[str],
        previous_status: OrderStatusEnum,
    ) -> None:
        """Move order to on-hold when payment fails."""
        if order.status in {OrderStatusEnum.CANCELED, OrderStatusEnum.COMPLETED}:
            return
        order.status = OrderStatusEnum.ON_HOLD
        failure_note = f"Payment failure: {reason}" if reason else "Payment failure"
        existing = (order.notes or "").strip()
        order.notes = "\n".join(note for note in [existing, failure_note] if note)
        await self.db.flush()
        await self._get_notification_service().send_order_status_update(
            order,
            previous_status=previous_status,
            trigger="payment_failure",
        )

    async def _start_fulfillment(self, order_id: UUID) -> None:
        """Trigger fulfillment workflow after successful payment."""
        try:
            started = await self._get_fulfillment_service().process_order_fulfillment(order_id)
            logger.info(
                "Fulfillment kickoff result",
                order_id=str(order_id),
                started=started
            )
        except Exception as exc:
            logger.error(
                "Failed to start fulfillment after payment success",
                order_id=str(order_id),
                error=str(exc)
            )
