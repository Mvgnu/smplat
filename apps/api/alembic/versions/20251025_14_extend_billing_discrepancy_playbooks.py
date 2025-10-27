"""Extend processor/discrepancy enums for enriched reconciliation."""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20251025_14"
down_revision: Union[str, None] = "20251022_13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATEMENT_TYPE = "processor_statement_transaction_type"
_DISCREPANCY_TYPE = "billing_discrepancy_type_enum"

_NEW_STATEMENT_VALUES = (
    "payout_reversal",
    "multi_invoice_payout",
    "dynamic_fee",
    "balance_adjustment",
    "cross_ledger_transfer",
    "fx_gain",
    "fx_loss",
    "dispute_withhold",
)

_NEW_DISCREPANCY_VALUES = (
    "payout_clawback",
    "multi_invoice_settlement",
    "dynamic_fee_variance",
    "cross_ledger_adjustment",
    "fx_impact",
    "balance_adjustment",
    "dispute_hold",
)


def upgrade() -> None:
    for value in _NEW_STATEMENT_VALUES:
        op.execute(
            f"ALTER TYPE {_STATEMENT_TYPE} ADD VALUE IF NOT EXISTS '{value}'"
        )
    for value in _NEW_DISCREPANCY_VALUES:
        op.execute(
            f"ALTER TYPE {_DISCREPANCY_TYPE} ADD VALUE IF NOT EXISTS '{value}'"
        )


def downgrade() -> None:
    # Postgres enum value removal is not supported without recreating the type.
    pass

