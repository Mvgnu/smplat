"""Gateway adapter orchestrating invoice payment captures and refunds."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import MutableSequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.providers import StripeBillingProvider, StripeHostedSession
from smplat_api.services.secrets.stripe import (
    StripeWorkspaceSecretsResolver,
    build_default_stripe_secrets_resolver,
)


@dataclass(slots=True)
class GatewayCaptureResult:
    """Outcome returned after a capture attempt."""

    # meta: gateway-capture: response
    intent_id: str
    charge_id: str
    customer_id: str | None
    captured_amount: Decimal
    captured_at: datetime
    was_new_intent: bool


@dataclass(slots=True)
class GatewayRefundResult:
    """Outcome returned after a refund attempt."""

    # meta: gateway-refund: response
    processor_id: str
    refund_id: str
    amount: Decimal
    refunded_at: datetime


class BillingGatewayClient:
    """High-level gateway facade for billing ledger operations."""

    # meta: billing-gateway: staged-rollout
    def __init__(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        *,
        provider: StripeBillingProvider | None = None,
        secrets_resolver: StripeWorkspaceSecretsResolver | None = None,
    ) -> None:
        self._db = db
        self._workspace_id = workspace_id
        self._provider = provider
        self._secrets_resolver = secrets_resolver or build_default_stripe_secrets_resolver()

    def _ensure_rollout(self) -> None:
        if settings.billing_rollout_stage == "disabled":
            raise RuntimeError("Billing gateway is disabled in current rollout stage")

    async def _resolve_provider(self) -> StripeBillingProvider:
        if self._provider is not None:
            return self._provider

        secrets = await self._secrets_resolver.get(self._workspace_id)
        if secrets is None:
            raise RuntimeError("Stripe credentials are not configured for this workspace")

        self._provider = StripeBillingProvider.from_credentials(
            secrets.api_key, secrets.webhook_secret
        )
        return self._provider

    async def create_hosted_session(
        self,
        invoice: Invoice,
        *,
        success_url: str,
        cancel_url: str,
    ) -> StripeHostedSession:
        """Generate a hosted checkout session for redirect flows."""

        self._ensure_rollout()
        amount = Decimal(invoice.balance_due or invoice.total or Decimal("0"))
        if amount <= 0:
            raise ValueError("Invoice amount must be positive for hosted checkout")
        provider = await self._resolve_provider()
        session = await provider.create_checkout_session(
            invoice_number=invoice.invoice_number,
            amount=amount,
            currency=invoice.currency.value,
            customer_id=invoice.processor_customer_id,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"invoice_id": str(invoice.id), "workspace_id": str(invoice.workspace_id)},
        )
        return session


    async def capture_payment(self, invoice: Invoice, amount: Decimal | None = None) -> GatewayCaptureResult:
        """Capture a payment for the given invoice and update ledger metadata."""

        self._ensure_rollout()
        capture_amount = Decimal(amount if amount is not None else invoice.balance_due or invoice.total or Decimal("0"))
        if capture_amount <= 0:
            raise ValueError("Capture amount must be positive")

        idempotency_key = f"invoice-{invoice.id}-capture"
        provider = await self._resolve_provider()
        provider_result = await provider.capture_payment(
            payment_intent_id=invoice.payment_intent_id,
            amount=capture_amount,
            currency=invoice.currency.value,
            customer_id=invoice.processor_customer_id,
            metadata={"invoice_id": str(invoice.id), "workspace_id": str(invoice.workspace_id)},
            idempotency_key=idempotency_key,
        )

        now = provider_result.captured_at
        timeline: MutableSequence[dict[str, object]] = list(invoice.payment_timeline_json or [])
        timeline.append(
            {
                "event": "captured",
                "at": now.isoformat(),
                "amount": float(provider_result.amount),
                "processor_id": provider_result.charge_id,
            }
        )

        new_balance = Decimal(invoice.balance_due or Decimal("0")) - provider_result.amount
        if new_balance <= 0:
            invoice.status = InvoiceStatusEnum.PAID
            invoice.balance_due = Decimal("0")
            invoice.paid_at = now
        else:
            invoice.balance_due = new_balance

        previous_intent = invoice.payment_intent_id
        invoice.payment_intent_id = provider_result.intent_id
        invoice.external_processor_id = provider_result.charge_id
        invoice.processor_charge_id = provider_result.charge_id
        invoice.processor_customer_id = provider_result.customer_id
        invoice.last_payment_error = None
        invoice.settlement_at = now
        invoice.payment_timeline_json = timeline

        await self._db.flush()

        return GatewayCaptureResult(
            intent_id=provider_result.intent_id,
            charge_id=provider_result.charge_id,
            customer_id=provider_result.customer_id,
            captured_amount=provider_result.amount,
            captured_at=now,
            was_new_intent=previous_intent != provider_result.intent_id,
        )

    async def refund_payment(self, invoice: Invoice, amount: Decimal | None = None) -> GatewayRefundResult:
        """Refund a processed payment and record ledger adjustments."""

        self._ensure_rollout()
        refund_amount = Decimal(amount if amount is not None else invoice.total or Decimal("0"))
        if refund_amount <= 0:
            raise ValueError("Refund amount must be positive")
        if not invoice.processor_charge_id:
            raise RuntimeError("Invoice does not have a captured charge to refund")

        idempotency_key = f"invoice-{invoice.id}-refund"
        provider = await self._resolve_provider()
        provider_result = await provider.refund_payment(
            charge_id=invoice.processor_charge_id,
            amount=refund_amount,
            metadata={"invoice_id": str(invoice.id), "workspace_id": str(invoice.workspace_id)},
            idempotency_key=idempotency_key,
        )

        now = provider_result.refunded_at
        timeline: MutableSequence[dict[str, object]] = list(invoice.payment_timeline_json or [])
        timeline.append(
            {
                "event": "refunded",
                "at": now.isoformat(),
                "amount": float(provider_result.amount * -1),
                "processor_id": provider_result.charge_id,
                "reference": provider_result.refund_id,
            }
        )

        adjustments: MutableSequence[dict[str, object]] = list(invoice.adjustments_json or [])
        adjustments.append(
            {
                "type": "refund",
                "amount": float(provider_result.amount),
                "memo": "Gateway refund",
                "applied_at": now.isoformat(),
                "reference": provider_result.refund_id,
            }
        )

        invoice.payment_timeline_json = timeline
        invoice.adjustments_json = adjustments
        invoice.adjustments_total = (Decimal(invoice.adjustments_total or Decimal("0")) - provider_result.amount)
        invoice.last_payment_error = provider_result.failure_reason if provider_result.failure_reason else None
        if invoice.status == InvoiceStatusEnum.PAID:
            invoice.status = InvoiceStatusEnum.ISSUED
        invoice.balance_due = Decimal(invoice.balance_due or Decimal("0")) + provider_result.amount

        await self._db.flush()

        return GatewayRefundResult(
            processor_id=provider_result.charge_id,
            refund_id=provider_result.refund_id,
            amount=provider_result.amount,
            refunded_at=now,
        )
