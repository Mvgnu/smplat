"""Stripe payment processing service."""

import stripe
from typing import Dict, Any, Optional
from decimal import Decimal
from loguru import logger

from smplat_api.core.settings import get_settings


class StripeService:
    """Service for handling Stripe payment operations."""
    
    def __init__(self):
        """Initialize Stripe service with API keys."""
        settings = get_settings()
        stripe.api_key = settings.stripe_secret_key
        self.webhook_secret = settings.stripe_webhook_secret
        
    async def create_checkout_session(
        self,
        order_id: str,
        line_items: list[Dict[str, Any]],
        customer_email: Optional[str] = None,
        success_url: str = "",
        cancel_url: str = "",
        metadata: Optional[Dict[str, str]] = None
    ) -> stripe.checkout.Session:
        """Create a Stripe Checkout session for payment processing.
        
        Args:
            order_id: Internal order identifier
            line_items: List of items with price and quantity
            customer_email: Customer email for prefilling
            success_url: URL to redirect after successful payment
            cancel_url: URL to redirect after cancelled payment
            metadata: Additional metadata to attach to the session
            
        Returns:
            Stripe checkout session object
            
        Raises:
            stripe.StripeError: If session creation fails
        """
        try:
            session_metadata = {"order_id": order_id}
            if metadata:
                session_metadata.update(metadata)
                
            session_data = {
                "mode": "payment",
                "line_items": line_items,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": session_metadata,
                "payment_intent_data": {
                    "metadata": session_metadata
                }
            }
            
            if customer_email:
                session_data["customer_email"] = customer_email
                
            session = stripe.checkout.Session.create(**session_data)
            
            logger.info(
                "Created Stripe checkout session",
                session_id=session.id,
                order_id=order_id,
                amount=sum(item.get("price_data", {}).get("unit_amount", 0) * item.get("quantity", 1) for item in line_items)
            )
            
            return session
            
        except stripe.StripeError as e:
            logger.error(
                "Failed to create Stripe checkout session",
                order_id=order_id,
                error=str(e)
            )
            raise
            
    async def create_subscription_checkout(
        self,
        order_id: str,
        price_id: str,
        customer_email: Optional[str] = None,
        trial_period_days: Optional[int] = None,
        success_url: str = "",
        cancel_url: str = "",
        metadata: Optional[Dict[str, str]] = None
    ) -> stripe.checkout.Session:
        """Create a Stripe Checkout session for subscription payment.
        
        Args:
            order_id: Internal order identifier
            price_id: Stripe price ID for the subscription
            customer_email: Customer email for prefilling
            trial_period_days: Number of trial days
            success_url: URL to redirect after successful payment
            cancel_url: URL to redirect after cancelled payment
            metadata: Additional metadata to attach to the session
            
        Returns:
            Stripe checkout session object
            
        Raises:
            stripe.StripeError: If session creation fails
        """
        try:
            session_metadata = {"order_id": order_id}
            if metadata:
                session_metadata.update(metadata)
                
            line_items = [{"price": price_id, "quantity": 1}]
            
            session_data = {
                "mode": "subscription",
                "line_items": line_items,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": session_metadata,
                "subscription_data": {
                    "metadata": session_metadata
                }
            }
            
            if customer_email:
                session_data["customer_email"] = customer_email
                
            if trial_period_days:
                session_data["subscription_data"]["trial_period_days"] = trial_period_days
                
            session = stripe.checkout.Session.create(**session_data)
            
            logger.info(
                "Created Stripe subscription checkout session",
                session_id=session.id,
                order_id=order_id,
                price_id=price_id
            )
            
            return session
            
        except stripe.StripeError as e:
            logger.error(
                "Failed to create Stripe subscription checkout session",
                order_id=order_id,
                error=str(e)
            )
            raise
            
    async def retrieve_payment_intent(self, payment_intent_id: str) -> stripe.PaymentIntent:
        """Retrieve a Stripe PaymentIntent by ID.
        
        Args:
            payment_intent_id: Stripe PaymentIntent ID
            
        Returns:
            Stripe PaymentIntent object
            
        Raises:
            stripe.StripeError: If retrieval fails
        """
        try:
            return stripe.PaymentIntent.retrieve(payment_intent_id)
        except stripe.StripeError as e:
            logger.error(
                "Failed to retrieve PaymentIntent",
                payment_intent_id=payment_intent_id,
                error=str(e)
            )
            raise
            
    async def retrieve_checkout_session(self, session_id: str) -> stripe.checkout.Session:
        """Retrieve a Stripe Checkout Session by ID.
        
        Args:
            session_id: Stripe Checkout Session ID
            
        Returns:
            Stripe Checkout Session object
            
        Raises:
            stripe.StripeError: If retrieval fails
        """
        try:
            return stripe.checkout.Session.retrieve(session_id)
        except stripe.StripeError as e:
            logger.error(
                "Failed to retrieve Checkout Session",
                session_id=session_id,
                error=str(e)
            )
            raise
            
    async def construct_webhook_event(
        self, 
        payload: bytes, 
        signature: str
    ) -> stripe.Event:
        """Construct and verify a Stripe webhook event.
        
        Args:
            payload: Raw webhook payload
            signature: Stripe signature header
            
        Returns:
            Verified Stripe Event object
            
        Raises:
            stripe.SignatureVerificationError: If signature verification fails
        """
        try:
            event = stripe.Webhook.construct_event(
                payload, signature, self.webhook_secret
            )
            
            logger.info(
                "Verified Stripe webhook event",
                event_type=event["type"],
                event_id=event["id"]
            )
            
            return event
            
        except stripe.SignatureVerificationError as e:
            logger.error(
                "Failed to verify Stripe webhook signature",
                error=str(e)
            )
            raise
            
    async def refund_payment(
        self, 
        payment_intent_id: str, 
        amount: Optional[int] = None,
        reason: Optional[str] = None
    ) -> stripe.Refund:
        """Create a refund for a payment.
        
        Args:
            payment_intent_id: Stripe PaymentIntent ID to refund
            amount: Amount to refund in cents (optional, defaults to full refund)
            reason: Reason for refund
            
        Returns:
            Stripe Refund object
            
        Raises:
            stripe.StripeError: If refund creation fails
        """
        try:
            refund_data = {"payment_intent": payment_intent_id}
            
            if amount:
                refund_data["amount"] = amount
                
            if reason:
                refund_data["reason"] = reason
                
            refund = stripe.Refund.create(**refund_data)
            
            logger.info(
                "Created Stripe refund",
                refund_id=refund.id,
                payment_intent_id=payment_intent_id,
                amount=refund.amount
            )
            
            return refund
            
        except stripe.StripeError as e:
            logger.error(
                "Failed to create Stripe refund",
                payment_intent_id=payment_intent_id,
                error=str(e)
            )
            raise
