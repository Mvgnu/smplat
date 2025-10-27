"""Resolution playbook metadata for billing discrepancies."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping

from smplat_api.models.billing_reconciliation import BillingDiscrepancyType


@dataclass(slots=True, frozen=True)
class DiscrepancyPlaybook:
    """Operator guidance for a discrepancy classification."""

    # meta: discrepancy-playbook: schema
    recommended_actions: tuple[str, ...]
    auto_resolve_threshold: Decimal | None = None
    escalation_after_hours: int | None = None
    notes: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """Render the playbook for API serialization."""

        return {
            "recommendedActions": list(self.recommended_actions),
            "autoResolveThreshold": float(self.auto_resolve_threshold)
            if self.auto_resolve_threshold is not None
            else None,
            "escalationAfterHours": self.escalation_after_hours,
            "notes": self.notes,
        }


_PLAYBOOKS: Mapping[BillingDiscrepancyType, DiscrepancyPlaybook] = {
    BillingDiscrepancyType.MULTI_INVOICE_SETTLEMENT: DiscrepancyPlaybook(
        recommended_actions=(
            "Cross-check settlement group invoices for missing payouts",
            "Confirm payout allocation matches invoice totals",
        ),
        auto_resolve_threshold=Decimal("5.00"),
        escalation_after_hours=24,
        notes="Auto-resolve when residual delta is below minor currency breakage threshold.",
    ),
    BillingDiscrepancyType.PAYOUT_CLAWBACK: DiscrepancyPlaybook(
        recommended_actions=(
            "Validate clawback reason with processor portal",
            "Notify finance stakeholder of revenue reversal",
        ),
        escalation_after_hours=4,
    ),
    BillingDiscrepancyType.DYNAMIC_FEE_VARIANCE: DiscrepancyPlaybook(
        recommended_actions=(
            "Review workspace pricing overrides",
            "Sync configured fee tiers with Stripe application fees",
        ),
        auto_resolve_threshold=Decimal("2.50"),
        escalation_after_hours=48,
    ),
    BillingDiscrepancyType.CROSS_LEDGER_ADJUSTMENT: DiscrepancyPlaybook(
        recommended_actions=(
            "Confirm transfer target workspace and ledger",
            "Update cross-ledger memo with supporting invoice references",
        ),
        escalation_after_hours=12,
    ),
    BillingDiscrepancyType.FX_IMPACT: DiscrepancyPlaybook(
        recommended_actions=(
            "Compare conversion rate against contracted FX schedule",
            "Post gain/loss journal entry for finance review",
        ),
        auto_resolve_threshold=Decimal("3.00"),
        escalation_after_hours=24,
    ),
    BillingDiscrepancyType.BALANCE_ADJUSTMENT: DiscrepancyPlaybook(
        recommended_actions=(
            "Review processor adjustment memo",
            "Document adjustment in reconciliation timeline",
        ),
        escalation_after_hours=24,
    ),
    BillingDiscrepancyType.DISPUTE_HOLD: DiscrepancyPlaybook(
        recommended_actions=(
            "Verify dispute evidence submission status",
            "Coordinate with support on customer outreach",
        ),
        escalation_after_hours=6,
    ),
    BillingDiscrepancyType.UNTRACKED_FEE: DiscrepancyPlaybook(
        recommended_actions=(
            "Match fee to originating invoice",
            "Update fee catalog if new charge type detected",
        ),
        auto_resolve_threshold=Decimal("1.00"),
        escalation_after_hours=48,
    ),
    BillingDiscrepancyType.UNAPPLIED_REFUND: DiscrepancyPlaybook(
        recommended_actions=(
            "Link refund to source invoice",
            "Confirm refund communication sent to customer",
        ),
        escalation_after_hours=8,
    ),
    BillingDiscrepancyType.FEE_ADJUSTMENT: DiscrepancyPlaybook(
        recommended_actions=("Validate adjustment memo", "Update fee accrual workbook"),
        auto_resolve_threshold=Decimal("1.00"),
        escalation_after_hours=24,
    ),
    BillingDiscrepancyType.REFUND_REVERSAL: DiscrepancyPlaybook(
        recommended_actions=(
            "Confirm reversal processed in Stripe",
            "Notify finance of refund re-settlement",
        ),
        escalation_after_hours=6,
    ),
    BillingDiscrepancyType.PAYOUT_DELAY: DiscrepancyPlaybook(
        recommended_actions=(
            "Review payout expected settlement date",
            "Escalate to Stripe support if delay exceeds SLA",
        ),
        escalation_after_hours=12,
    ),
    BillingDiscrepancyType.MISSING_INVOICE: DiscrepancyPlaybook(
        recommended_actions=(
            "Locate or create invoice for orphaned transaction",
            "Annotate staging entry with resolution context",
        ),
        escalation_after_hours=24,
    ),
}


def get_discrepancy_playbook(
    discrepancy_type: BillingDiscrepancyType | str,
) -> dict[str, Any] | None:
    """Return the structured playbook metadata for a discrepancy type."""

    if isinstance(discrepancy_type, str):
        try:
            typed = BillingDiscrepancyType(discrepancy_type)
        except ValueError:
            return None
    else:
        typed = discrepancy_type

    playbook = _PLAYBOOKS.get(typed)
    if playbook is None:
        return None
    return playbook.to_payload()

