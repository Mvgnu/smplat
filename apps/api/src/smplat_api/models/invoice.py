"""Billing invoice models."""

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
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base
from .customer_profile import CurrencyEnum


class InvoiceStatusEnum(str, Enum):
    """Lifecycle state for issued invoices."""

    DRAFT = "draft"
    ISSUED = "issued"
    PAID = "paid"
    VOID = "void"
    OVERDUE = "overdue"


class Invoice(Base):
    """Represents a client invoice scoped to a workspace."""

    __tablename__ = "invoices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invoice_number = Column(String, nullable=False, unique=True)
    status = Column(
        SqlEnum(InvoiceStatusEnum, name="invoice_status_enum"),
        nullable=False,
        server_default=InvoiceStatusEnum.ISSUED.value,
    )
    currency = Column(
        SqlEnum(CurrencyEnum, name="preferred_currency_enum", create_type=False),
        nullable=False,
        server_default=CurrencyEnum.EUR.value,
    )
    subtotal = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax = Column(Numeric(12, 2), nullable=False, server_default="0")
    total = Column(Numeric(12, 2), nullable=False, server_default="0")
    balance_due = Column(Numeric(12, 2), nullable=False, server_default="0")
    payment_intent_id = Column(String, nullable=True)
    external_processor_id = Column(String, nullable=True)
    processor_customer_id = Column(String, nullable=True)
    processor_charge_id = Column(String, nullable=True)
    webhook_replay_token = Column(String, nullable=True)
    last_payment_error = Column(Text, nullable=True)
    settlement_at = Column(DateTime(timezone=True), nullable=True)
    adjustments_total = Column(Numeric(12, 2), nullable=False, server_default="0")
    adjustments_json = Column("adjustments", JSON, nullable=True)
    payment_timeline_json = Column("payment_timeline", JSON, nullable=True)
    issued_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    due_at = Column(DateTime(timezone=True), nullable=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    memo = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    workspace = relationship("User")
    line_items = relationship(
        "InvoiceLineItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLineItem.display_order",
    )


class InvoiceLineItem(Base):
    """Individual service line attached to an invoice."""

    __tablename__ = "invoice_line_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    invoice_id = Column(
        UUID(as_uuid=True),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    description = Column(String, nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False, server_default="1")
    unit_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    total_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    campaign_reference = Column(String, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    display_order = Column(Integer, nullable=False, server_default="0")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    invoice = relationship("Invoice", back_populates="line_items")
    order = relationship("Order")
