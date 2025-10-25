from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base
from .customer_profile import CurrencyEnum


class PaymentStatusEnum(str, Enum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REFUNDED = "refunded"


class PaymentProviderEnum(str, Enum):
    STRIPE = "stripe"
    MANUAL = "manual"


class Payment(Base):
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    provider = Column(
        SqlEnum(PaymentProviderEnum, name="payment_provider_enum"),
        nullable=False,
        server_default=PaymentProviderEnum.STRIPE.value,
    )
    provider_reference = Column(String, nullable=False, unique=True)
    status = Column(
        SqlEnum(PaymentStatusEnum, name="payment_status_enum"),
        nullable=False,
        server_default=PaymentStatusEnum.PENDING.value,
    )
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(
        SqlEnum(CurrencyEnum, name="preferred_currency_enum", create_type=False),
        nullable=False,
        server_default=CurrencyEnum.EUR.value,
    )
    failure_reason = Column(Text, nullable=True)
    captured_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    order = relationship("Order", back_populates="payments")
