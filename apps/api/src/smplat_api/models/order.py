from enum import Enum
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base
from .customer_profile import CurrencyEnum


class OrderStatusEnum(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    ACTIVE = "active"
    COMPLETED = "completed"
    ON_HOLD = "on_hold"
    CANCELED = "canceled"


class OrderSourceEnum(str, Enum):
    CHECKOUT = "checkout"
    MANUAL = "manual"


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_number = Column(String, nullable=False, unique=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(
        SqlEnum(OrderStatusEnum, name="order_status_enum"),
        nullable=False,
        server_default=OrderStatusEnum.PENDING.value,
    )
    source = Column(
        SqlEnum(OrderSourceEnum, name="order_source_enum"),
        nullable=False,
        server_default=OrderSourceEnum.CHECKOUT.value,
    )
    subtotal = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax = Column(Numeric(12, 2), nullable=False, server_default="0")
    total = Column(Numeric(12, 2), nullable=False, server_default="0")
    currency = Column(
        SqlEnum(CurrencyEnum, name="preferred_currency_enum", create_type=False),
        nullable=False,
        server_default=CurrencyEnum.EUR.value,
    )
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    product_title = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False, server_default="1")
    unit_price = Column(Numeric(12, 2), nullable=False)
    total_price = Column(Numeric(12, 2), nullable=False)
    selected_options = Column(JSON, nullable=True)
    attributes = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    order = relationship("Order", back_populates="items")
    fulfillment_tasks = relationship("FulfillmentTask", back_populates="order_item", cascade="all, delete-orphan")
    service_campaign = relationship("ServiceCampaign", back_populates="order_item", uselist=False)
