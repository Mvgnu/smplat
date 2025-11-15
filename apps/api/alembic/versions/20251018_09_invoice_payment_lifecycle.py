"""Enhance invoices with payment lifecycle metadata.

Revision ID: 20251018_09
Revises: 20251017_08
Create Date: 2025-10-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251018_09"
down_revision: Union[str, None] = "20251017_08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create invoice_status_enum if it doesn't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum') THEN
                CREATE TYPE invoice_status_enum AS ENUM ('draft', 'issued', 'paid', 'void', 'overdue');
            END IF;
        END $$;
    """)

    # Create invoices table if it doesn't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
                CREATE TABLE invoices (
                    id UUID PRIMARY KEY,
                    workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    invoice_number VARCHAR NOT NULL UNIQUE,
                    status invoice_status_enum NOT NULL DEFAULT 'issued',
                    currency preferred_currency_enum NOT NULL DEFAULT 'EUR',
                    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    payment_intent_id VARCHAR,
                    external_processor_id VARCHAR,
                    settlement_at TIMESTAMP WITH TIME ZONE,
                    adjustments_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    adjustments JSON,
                    payment_timeline JSON,
                    issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    paid_at TIMESTAMP WITH TIME ZONE,
                    voided_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                );
                CREATE INDEX ix_invoices_workspace_id ON invoices(workspace_id);
                CREATE INDEX ix_invoices_status ON invoices(status);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.drop_table("invoices")
    op.execute("DROP TYPE IF EXISTS invoice_status_enum")
