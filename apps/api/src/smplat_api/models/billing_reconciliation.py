"""Models representing processor statements and reconciliation runs."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class ProcessorStatementTransactionType(str, Enum):
    """Enumerates supported processor statement transaction types."""

    CHARGE = "charge"
    REFUND = "refund"
    FEE = "fee"
    PAYOUT = "payout"
    ADJUSTMENT = "adjustment"
    FEE_ADJUSTMENT = "fee_adjustment"
    REFUND_REVERSAL = "refund_reversal"
    PAYOUT_DELAY = "payout_delay"
    PAYOUT_REVERSAL = "payout_reversal"
    MULTI_INVOICE_PAYOUT = "multi_invoice_payout"
    DYNAMIC_FEE = "dynamic_fee"
    BALANCE_ADJUSTMENT = "balance_adjustment"
    CROSS_LEDGER_TRANSFER = "cross_ledger_transfer"
    FX_GAIN = "fx_gain"
    FX_LOSS = "fx_loss"
    DISPUTE_WITHHOLD = "dispute_withhold"


class BillingDiscrepancyType(str, Enum):
    """Categories of reconciliation discrepancies."""

    MISSING_INVOICE = "missing_invoice"
    AMOUNT_MISMATCH = "amount_mismatch"
    UNAPPLIED_REFUND = "unapplied_refund"
    UNTRACKED_FEE = "untracked_fee"
    UNKNOWN = "unknown"
    FEE_ADJUSTMENT = "fee_adjustment"
    REFUND_REVERSAL = "refund_reversal"
    PAYOUT_DELAY = "payout_delay"
    PAYOUT_CLAWBACK = "payout_clawback"
    MULTI_INVOICE_SETTLEMENT = "multi_invoice_settlement"
    DYNAMIC_FEE_VARIANCE = "dynamic_fee_variance"
    CROSS_LEDGER_ADJUSTMENT = "cross_ledger_adjustment"
    FX_IMPACT = "fx_impact"
    BALANCE_ADJUSTMENT = "balance_adjustment"
    DISPUTE_HOLD = "dispute_hold"


class BillingDiscrepancyStatus(str, Enum):
    """Lifecycle status for discrepancy review."""

    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class ProcessorStatement(Base):
    """Normalized transaction row sourced from the payment processor."""

    __tablename__ = "processor_statements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    processor = Column(String(32), nullable=False)
    transaction_id = Column(String(128), nullable=False, unique=True)
    charge_id = Column(String(128), nullable=True)
    transaction_type = Column(
        SqlEnum(ProcessorStatementTransactionType, name="processor_statement_transaction_type"),
        nullable=False,
    )
    currency = Column(String(8), nullable=False)
    gross_amount = Column(Numeric(12, 2), nullable=False)
    fee_amount = Column(Numeric(12, 2), nullable=True)
    net_amount = Column(Numeric(12, 2), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    invoice = relationship("Invoice", backref="processor_statements")


class ProcessorStatementStagingStatus(str, Enum):
    """Workflow states for staging triage and escalation."""

    PENDING = "pending"
    TRIAGED = "triaged"
    RESOLVED = "resolved"
    REQUEUED = "requeued"


class ProcessorStatementStaging(Base):
    """Staging area for processor events that require manual triage."""

    __tablename__ = "processor_statement_staging"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    transaction_id = Column(String(128), nullable=False, unique=True)
    processor = Column(String(32), nullable=False)
    reason = Column(String(128), nullable=False)
    payload = Column(JSON, nullable=True)
    workspace_hint = Column(UUID(as_uuid=True), nullable=True, index=True)
    status = Column(
        SqlEnum(ProcessorStatementStagingStatus, name="processor_statement_staging_status"),
        nullable=False,
        server_default=ProcessorStatementStagingStatus.PENDING.value,
    )
    triage_note = Column(Text, nullable=True)
    last_triaged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    requeue_count = Column(Integer, nullable=False, server_default="0")
    first_observed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_observed_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # meta: staging-table: processor-statements


class BillingReconciliationRun(Base):
    """Represents a reconciliation execution sweep."""

    __tablename__ = "billing_reconciliation_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(32), nullable=False, server_default="running")
    total_transactions = Column(Integer, nullable=False, server_default="0")
    matched_transactions = Column(Integer, nullable=False, server_default="0")
    discrepancy_count = Column(Integer, nullable=False, server_default="0")
    notes = Column(Text, nullable=True)

    discrepancies = relationship(
        "BillingDiscrepancy",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="BillingDiscrepancy.created_at",
    )


class BillingDiscrepancy(Base):
    """Individual discrepancy discovered during reconciliation."""

    __tablename__ = "billing_discrepancies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("billing_reconciliation_runs.id", ondelete="CASCADE"), nullable=False)
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True)
    processor_statement_id = Column(
        UUID(as_uuid=True), ForeignKey("processor_statements.id", ondelete="SET NULL"), nullable=True
    )
    transaction_id = Column(String(128), nullable=True)
    discrepancy_type = Column(
        SqlEnum(BillingDiscrepancyType, name="billing_discrepancy_type_enum"),
        nullable=False,
    )
    status = Column(
        SqlEnum(BillingDiscrepancyStatus, name="billing_discrepancy_status_enum"),
        nullable=False,
        server_default=BillingDiscrepancyStatus.OPEN.value,
    )
    amount_delta = Column(Numeric(12, 2), nullable=True)
    summary = Column(Text, nullable=True)
    resolution_note = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    run = relationship("BillingReconciliationRun", back_populates="discrepancies")
    invoice = relationship("Invoice", backref="billing_discrepancies")
    processor_statement = relationship("ProcessorStatement", backref="discrepancies")


class BillingSyncCursor(Base):
    """Durable cursor checkpoint for processor ingestion windows."""

    __tablename__ = "billing_sync_cursors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    processor = Column(String(32), nullable=False)
    object_type = Column(String(64), nullable=False)
    cursor_token = Column(String(256), nullable=True)
    last_transaction_id = Column(String(128), nullable=True)
    last_transaction_occurred_at = Column(DateTime(timezone=True), nullable=True)
    last_transaction_updated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "processor",
            "object_type",
            name="uq_billing_sync_cursor_scope",
        ),
    )

    # meta: billing-sync-cursor: durable-checkpoint
