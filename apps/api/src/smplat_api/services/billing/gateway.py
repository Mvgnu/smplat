"""Gateway adapter orchestrating invoice payment captures and refunds."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import MutableSequence
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.models.hosted_checkout_session import (
    HostedCheckoutSession,
    HostedCheckoutSessionStatusEnum,
)
from smplat_api.models.invoice import Invoice, InvoiceStatusEnum
from smplat_api.services.billing.providers import (
    StripeBillingProvider,
    StripeCaptureResponse,
    StripeHostedSession,
    StripeRefundResponse,
)
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
            secrets = await self._secrets_resolver.get(None)
        if secrets is None:
            if settings.environment == "development":
                self._provider = _StubStripeBillingProvider()
                return self._provider
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
        regenerate_from: HostedCheckoutSession | None = None,
        retry_backoff: timedelta = timedelta(hours=12),
        recovery_note: str | None = None,
    ) -> StripeHostedSession:
        """Generate a hosted checkout session for redirect flows."""

        self._ensure_rollout()
        amount = Decimal(invoice.balance_due or invoice.total or Decimal("0"))
        if amount <= 0:
            raise ValueError("Invoice amount must be positive for hosted checkout")
        provider = await self._resolve_provider()
        now = datetime.now(timezone.utc)

        if regenerate_from is not None:
            # meta: hosted-session: regeneration-swap
            regenerate_from.status = HostedCheckoutSessionStatusEnum.ABANDONED
            regenerate_from.cancelled_at = now
            regenerate_from.last_error = (
                regenerate_from.last_error or "replaced_by_regeneration"
            )
            previous_metadata = dict(regenerate_from.metadata_json or {})
            previous_metadata["last_webhook_event"] = "operator.regenerated"
            previous_metadata["regenerated_at"] = now.isoformat()
            regenerate_from.metadata_json = previous_metadata

        retry_count = 0
        last_retry_at: datetime | None = None
        next_retry_at: datetime | None = None
        if regenerate_from is not None:
            retry_count = (regenerate_from.retry_count or 0) + 1
            last_retry_at = now
            next_retry_at = (
                now + retry_backoff if retry_backoff.total_seconds() > 0 else None
            )

        session_note = recovery_note
        if regenerate_from is not None and recovery_note:
            session_note = f"{recovery_note} (regenerated from {regenerate_from.session_id})"
        elif regenerate_from is not None and recovery_note is None:
            session_note = f"regenerated from {regenerate_from.session_id}"

        pending_session = HostedCheckoutSession(
            session_id=f"pending-{uuid4()}",
            workspace_id=self._workspace_id,
            invoice_id=invoice.id,
            status=HostedCheckoutSessionStatusEnum.INITIATED,
            retry_count=retry_count,
            last_retry_at=last_retry_at,
            next_retry_at=next_retry_at,
            metadata_json={
                "invoice_id": str(invoice.id),
                "workspace_id": str(invoice.workspace_id),
                "success_url": success_url,
                "cancel_url": cancel_url,
                "hosted_session_id": None,
                "provider": "stripe",
                **(
                    {
                        "regenerated_from_id": str(regenerate_from.id),
                        "retry_count": retry_count,
                        "retry_backoff_seconds": int(
                            retry_backoff.total_seconds()
                        ),
                        "last_retry_at": last_retry_at.isoformat()
                        if last_retry_at
                        else None,
                        "next_retry_at": next_retry_at.isoformat()
                        if next_retry_at
                        else None,
                    }
                    if regenerate_from is not None
                    else {}
                ),
            },
            recovery_notes=session_note,
        )
        if session_note:
            pending_session.metadata_json["recovery_note"] = session_note
        self._db.add(pending_session)
        await self._db.flush()

        provider_metadata = {
            "invoice_id": str(invoice.id),
            "workspace_id": str(invoice.workspace_id),
            "hosted_session_id": str(pending_session.id),
        }
        if regenerate_from is not None:
            provider_metadata["regenerated_from_id"] = str(regenerate_from.id)

        session = await provider.create_checkout_session(
            invoice_number=invoice.invoice_number,
            amount=amount,
            currency=invoice.currency.value,
            customer_id=invoice.processor_customer_id,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=provider_metadata,
        )
        pending_session.session_id = session.session_id
        pending_session.expires_at = session.expires_at
        pending_session.metadata_json = {
            "provider": "stripe",
            "session_url": session.url,
            "invoice_id": str(invoice.id),
            "workspace_id": str(invoice.workspace_id),
            "success_url": success_url,
            "cancel_url": cancel_url,
            "hosted_session_id": str(pending_session.id),
            "regenerated_from_id": (
                str(regenerate_from.id) if regenerate_from is not None else None
            ),
            "retry_count": retry_count,
            "last_retry_at": last_retry_at.isoformat() if last_retry_at else None,
            "next_retry_at": next_retry_at.isoformat() if next_retry_at else None,
        }
        if regenerate_from is not None:
            regenerated_meta = dict(regenerate_from.metadata_json or {})
            regenerated_meta["regenerated_to_id"] = str(pending_session.id)
            regenerate_from.metadata_json = regenerated_meta

        invoice.hosted_session_id = pending_session.id
        await self._db.flush()
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
        charge_identifier = invoice.processor_charge_id or invoice.external_processor_id
        if not charge_identifier:
            raise RuntimeError("Invoice does not have a captured charge to refund")

        if invoice.processor_charge_id is None:
            invoice.processor_charge_id = charge_identifier

        idempotency_key = f"invoice-{invoice.id}-refund"
        provider = await self._resolve_provider()
        provider_result = await provider.refund_payment(
            charge_id=charge_identifier,
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
class _StubStripeBillingProvider:
    """Fallback provider used in development when Stripe credentials are absent."""

    # meta: billing-provider: stub

    def __init__(self) -> None:
        self.webhook_secret = "stub"

    async def create_checkout_session(self, **_: object) -> StripeHostedSession:  # type: ignore[override]
        now = datetime.now(timezone.utc) + timedelta(hours=1)
        return StripeHostedSession(
            session_id=f"stub-session-{uuid4()}",
            url="https://checkout.example/stub",
            expires_at=now,
        )

    async def capture_payment(self, **kwargs: object):  # type: ignore[override]
        amount = Decimal(kwargs.get("amount", Decimal("0")))
        currency = str(kwargs.get("currency", "usd"))
        customer_id = kwargs.get("customer_id")
        now = datetime.now(timezone.utc)
        return StripeCaptureResponse(  # type: ignore[name-defined]
            intent_id="stub_intent",
            charge_id="stub_charge",
            amount=amount,
            currency=currency,
            customer_id=str(customer_id) if customer_id else None,
            captured_at=now,
        )

    async def refund_payment(self, **kwargs: object):  # type: ignore[override]
        amount = Decimal(kwargs.get("amount", Decimal("0")))
        currency = str(kwargs.get("currency", "usd"))
        now = datetime.now(timezone.utc)
        return StripeRefundResponse(  # type: ignore[name-defined]
            refund_id="stub_refund",
            charge_id="stub_charge",
            amount=amount,
            currency=currency,
            failure_reason=None,
            refunded_at=now,
        )
