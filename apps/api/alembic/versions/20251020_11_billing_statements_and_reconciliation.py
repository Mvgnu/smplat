"""Add processor statements and reconciliation tables.

Revision ID: 20251020_11
Revises: 20251019_10
Create Date: 2025-10-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251020_11"
down_revision: Union[str, None] = "20251019_10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processor_statement_transaction_type') THEN
                CREATE TYPE processor_statement_transaction_type AS ENUM ('charge', 'refund', 'fee', 'payout', 'adjustment');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_discrepancy_type_enum') THEN
                CREATE TYPE billing_discrepancy_type_enum AS ENUM ('missing_invoice', 'amount_mismatch', 'unapplied_refund', 'untracked_fee', 'unknown');
            END IF;
        END $$;
    """)

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_discrepancy_status_enum') THEN
                CREATE TYPE billing_discrepancy_status_enum AS ENUM ('open', 'acknowledged', 'resolved');
            END IF;
        END $$;
    """)

    op.create_table(
        "processor_statements",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("processor", sa.String(length=32), nullable=False),
        sa.Column("transaction_id", sa.String(length=128), nullable=False),
        sa.Column("charge_id", sa.String(length=128), nullable=True),
        sa.Column("transaction_type", sa.dialects.postgresql.ENUM("charge", "refund", "fee", "payout", "adjustment", name="processor_statement_transaction_type", create_type=False), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("fee_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("net_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("transaction_id", name="uq_processor_statements_transaction_id"),
    )

    op.create_index("ix_processor_statements_invoice_id", "processor_statements", ["invoice_id"])
    op.create_index("ix_processor_statements_workspace_id", "processor_statements", ["workspace_id"])

    op.create_table(
        "billing_reconciliation_runs",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("total_transactions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_transactions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discrepancy_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "billing_discrepancies",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("processor_statement_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("transaction_id", sa.String(length=128), nullable=True),
        sa.Column("discrepancy_type", sa.dialects.postgresql.ENUM("missing_invoice", "amount_mismatch", "unapplied_refund", "untracked_fee", "unknown", name="billing_discrepancy_type_enum", create_type=False), nullable=False),
        sa.Column("status", sa.dialects.postgresql.ENUM("open", "acknowledged", "resolved", name="billing_discrepancy_status_enum", create_type=False), nullable=False, server_default="open"),
        sa.Column("amount_delta", sa.Numeric(12, 2), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["billing_reconciliation_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["processor_statement_id"], ["processor_statements.id"], ondelete="SET NULL"),
    )

    op.create_index("ix_billing_discrepancies_status", "billing_discrepancies", ["status"])
    op.create_index("ix_billing_discrepancies_discrepancy_type", "billing_discrepancies", ["discrepancy_type"])


def downgrade() -> None:
    op.drop_index("ix_billing_discrepancies_discrepancy_type", table_name="billing_discrepancies")
    op.drop_index("ix_billing_discrepancies_status", table_name="billing_discrepancies")
    op.drop_table("billing_discrepancies")
    op.drop_table("billing_reconciliation_runs")

    op.drop_index("ix_processor_statements_workspace_id", table_name="processor_statements")
    op.drop_index("ix_processor_statements_invoice_id", table_name="processor_statements")
    op.drop_table("processor_statements")

    billing_discrepancy_status.drop(op.get_bind(), checkfirst=True)
    billing_discrepancy_type.drop(op.get_bind(), checkfirst=True)
    processor_statement_transaction_type.drop(op.get_bind(), checkfirst=True)
