"""Stripe provider abstractions for billing operations."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Final, Iterable, Mapping

import stripe

from smplat_api.core.settings import settings


@dataclass(slots=True)
class StripeCaptureResponse:
    """Result payload returned after capturing funds."""

    # meta: capture-response: typed-dto
    intent_id: str
    charge_id: str
    amount: Decimal
    currency: str
    customer_id: str | None
    captured_at: datetime


@dataclass(slots=True)
class StripeRefundResponse:
    """Result payload returned after issuing a refund."""

    # meta: refund-response: typed-dto
    refund_id: str
    charge_id: str
    amount: Decimal
    currency: str
    failure_reason: str | None
    refunded_at: datetime


@dataclass(slots=True)
class StripeHostedSession:
    """Hosted checkout session description."""

    # meta: hosted-session: typed-dto
    session_id: str
    url: str
    expires_at: datetime


@dataclass(slots=True)
class StripeBalanceTransaction:
    """Normalized balance transaction data used for statements."""

    transaction_id: str
    type: str
    amount: Decimal
    currency: str
    fee: Decimal
    net: Decimal
    created_at: datetime
    source_id: str | None
    raw: Mapping[str, Any]


@dataclass(slots=True)
class StripeDisputeRecord:
    """Normalized dispute payload returned from Stripe."""

    dispute_id: str
    charge_id: str | None
    status: str
    amount: Decimal
    currency: str
    reason: str | None
    created_at: datetime
    raw: Mapping[str, Any]


class StripeBillingProvider:
    """Thin asynchronous wrapper around the official Stripe SDK."""

    # meta: billing-provider: stripe
    _APPLICATION_FEE_KEY: Final[str] = "smplat.invoice.application_fee"

    def __init__(self, secret_key: str, webhook_secret: str | None = None) -> None:
        if not secret_key:
            raise ValueError("Stripe secret key must be provided")
        self._secret_key = secret_key
        self._webhook_secret = webhook_secret
        stripe.api_key = secret_key

    @classmethod
    def from_settings(cls) -> "StripeBillingProvider":
        """Build the provider using application settings."""

        return cls(settings.stripe_secret_key, settings.stripe_webhook_secret)

    async def _run(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Execute blocking Stripe SDK calls in a worker thread."""

        return await asyncio.to_thread(func, *args, **kwargs)

    @staticmethod
    def _to_cents(amount: Decimal) -> int:
        """Normalize decimal currency amounts to Stripe-compatible cents."""

        quantized = amount.quantize(Decimal("0.01"))
        return int((quantized * 100).to_integral_value())

    @staticmethod
    def _from_cents(amount: int) -> Decimal:
        """Convert Stripe integer cents into Decimal amounts."""

        return Decimal(amount) / Decimal(100)

    async def create_checkout_session(
        self,
        *,
        invoice_number: str,
        amount: Decimal,
        currency: str,
        customer_id: str | None,
        success_url: str,
        cancel_url: str,
        metadata: Mapping[str, str] | None = None,
    ) -> StripeHostedSession:
        """Create a hosted checkout session for the invoice."""

        payload: dict[str, Any] = {
            "mode": "payment",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": dict(metadata or {}),
            "line_items": [
                {
                    "price_data": {
                        "currency": currency.lower(),
                        "product_data": {"name": f"Invoice {invoice_number}"},
                        "unit_amount": self._to_cents(amount),
                    },
                    "quantity": 1,
                }
            ],
        }
        if customer_id:
            payload["customer"] = customer_id

        session = await self._run(
            stripe.checkout.Session.create,
            **payload,
        )
        expires_at = datetime.fromtimestamp(session["expires_at"], tz=timezone.utc)
        return StripeHostedSession(
            session_id=session["id"],
            url=session["url"],
            expires_at=expires_at,
        )

    async def capture_payment(
        self,
        *,
        payment_intent_id: str | None,
        amount: Decimal,
        currency: str,
        customer_id: str | None,
        metadata: Mapping[str, str],
        idempotency_key: str,
    ) -> StripeCaptureResponse:
        """Capture funds for an invoice, creating or reusing a payment intent."""

        normalized_amount = self._to_cents(amount)
        metadata_payload = dict(metadata)
        if payment_intent_id:
            intent = await self._run(
                stripe.PaymentIntent.capture,
                payment_intent_id,
                amount_to_capture=normalized_amount,
                idempotency_key=idempotency_key,
            )
        else:
            intent = await self._run(
                stripe.PaymentIntent.create,
                amount=normalized_amount,
                currency=currency.lower(),
                customer=customer_id,
                confirm=True,
                metadata=metadata_payload,
                automatic_payment_methods={"enabled": True},
                idempotency_key=idempotency_key,
            )

        charges = intent.get("charges", {}).get("data", [])
        if not charges:
            raise RuntimeError("Stripe intent did not include charge data")
        charge = charges[0]
        captured_at = datetime.fromtimestamp(charge.get("created", 0), tz=timezone.utc)
        captured_amount = Decimal(charge.get("amount_captured", normalized_amount)) / Decimal(100)
        return StripeCaptureResponse(
            intent_id=intent["id"],
            charge_id=charge["id"],
            amount=captured_amount,
            currency=charge.get("currency", currency).upper(),
            customer_id=intent.get("customer"),
            captured_at=captured_at,
        )

    async def refund_payment(
        self,
        *,
        charge_id: str,
        amount: Decimal,
        metadata: Mapping[str, str],
        idempotency_key: str,
    ) -> StripeRefundResponse:
        """Issue a refund for a prior captured charge."""

        normalized_amount = self._to_cents(amount)
        refund = await self._run(
            stripe.Refund.create,
            charge=charge_id,
            amount=normalized_amount,
            metadata=dict(metadata),
            idempotency_key=idempotency_key,
        )
        refunded_at = datetime.fromtimestamp(refund.get("created", 0), tz=timezone.utc)
        amount_refunded = Decimal(refund.get("amount", normalized_amount)) / Decimal(100)
        raw_currency = refund.get("currency")
        currency_code = str(raw_currency).upper() if raw_currency else "USD"
        return StripeRefundResponse(
            refund_id=refund["id"],
            charge_id=refund.get("charge", charge_id),
            amount=amount_refunded,
            currency=currency_code,
            failure_reason=refund.get("failure_reason"),
            refunded_at=refunded_at,
        )

    async def list_balance_transactions(
        self,
        *,
        created_gte: datetime | None = None,
        created_lte: datetime | None = None,
        types: Iterable[str] | None = None,
        limit: int = 100,
    ) -> list[StripeBalanceTransaction]:
        """Return balance transactions within the specified window."""

        params: dict[str, Any] = {"limit": limit}
        if created_gte or created_lte:
            created_filter: dict[str, int] = {}
            if created_gte:
                created_filter["gte"] = int(created_gte.timestamp())
            if created_lte:
                created_filter["lte"] = int(created_lte.timestamp())
            params["created"] = created_filter
        if types:
            params["type"] = list(types)

        response = await self._run(stripe.BalanceTransaction.list, **params)
        transactions: list[StripeBalanceTransaction] = []
        for item in response.get("data", []):
            created = datetime.fromtimestamp(item.get("created", 0), tz=timezone.utc)
            transactions.append(
                StripeBalanceTransaction(
                    transaction_id=str(item.get("id")),
                    type=str(item.get("type", "unknown")),
                    amount=self._from_cents(int(item.get("amount", 0))),
                    currency=str(item.get("currency", "USD")).upper(),
                    fee=self._from_cents(int(item.get("fee", 0))),
                    net=self._from_cents(int(item.get("net", 0))),
                    created_at=created,
                    source_id=str(item.get("source")) if item.get("source") else None,
                    raw=item,
                )
            )
        return transactions

    async def list_disputes(
        self,
        *,
        created_gte: datetime | None = None,
        created_lte: datetime | None = None,
        limit: int = 100,
    ) -> list[StripeDisputeRecord]:
        """Fetch dispute records for the given window."""

        params: dict[str, Any] = {"limit": limit}
        if created_gte or created_lte:
            created_filter: dict[str, int] = {}
            if created_gte:
                created_filter["gte"] = int(created_gte.timestamp())
            if created_lte:
                created_filter["lte"] = int(created_lte.timestamp())
            params["created"] = created_filter

        response = await self._run(stripe.Dispute.list, **params)
        disputes: list[StripeDisputeRecord] = []
        for item in response.get("data", []):
            created = datetime.fromtimestamp(item.get("created", 0), tz=timezone.utc)
            amount = self._from_cents(int(item.get("amount", 0)))
            currency = str(item.get("currency", "USD")).upper()
            disputes.append(
                StripeDisputeRecord(
                    dispute_id=str(item.get("id")),
                    charge_id=str(item.get("charge")) if item.get("charge") else None,
                    status=str(item.get("status", "unknown")),
                    amount=amount,
                    currency=currency,
                    reason=str(item.get("reason")) if item.get("reason") else None,
                    created_at=created,
                    raw=item,
                )
            )
        return disputes

    async def retrieve_charge(self, charge_id: str) -> Mapping[str, Any]:
        """Retrieve a charge object from Stripe."""

        if not charge_id:
            raise ValueError("charge_id is required")
        charge = await self._run(stripe.Charge.retrieve, charge_id)
        return charge

    @property
    def webhook_secret(self) -> str | None:
        """Expose configured webhook signing secret."""

        return self._webhook_secret


__all__ = [
    "StripeBillingProvider",
    "StripeCaptureResponse",
    "StripeHostedSession",
    "StripeRefundResponse",
    "StripeBalanceTransaction",
    "StripeDisputeRecord",
]
