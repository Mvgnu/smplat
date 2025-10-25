from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base
from .customer_profile import CurrencyEnum


class ProductStatusEnum(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ProductOptionGroupTypeEnum(str, Enum):
    SINGLE = "single"
    MULTIPLE = "multiple"


class ProductCustomFieldTypeEnum(str, Enum):
    TEXT = "text"
    URL = "url"
    NUMBER = "number"


class ProductSubscriptionBillingCycleEnum(str, Enum):
    ONE_TIME = "one_time"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"


class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    slug = Column(String, nullable=False, unique=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=False)
    base_price = Column(Numeric(10, 2), nullable=False)
    currency = Column(
        SqlEnum(CurrencyEnum, name="preferred_currency_enum", create_type=False),
        nullable=False,
        server_default=CurrencyEnum.EUR.value,
    )
    status = Column(
        SqlEnum(ProductStatusEnum, name="product_status_enum"),
        nullable=False,
        server_default=ProductStatusEnum.DRAFT.value,
    )
    fulfillment_config = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    option_groups = relationship(
        "ProductOptionGroup",
        back_populates="product",
        order_by="ProductOptionGroup.display_order",
        cascade="all, delete-orphan",
    )
    add_ons = relationship(
        "ProductAddOn",
        back_populates="product",
        order_by="ProductAddOn.display_order",
        cascade="all, delete-orphan",
    )
    custom_fields = relationship(
        "ProductCustomField",
        back_populates="product",
        order_by="ProductCustomField.display_order",
        cascade="all, delete-orphan",
    )
    subscription_plans = relationship(
        "ProductSubscriptionPlan",
        back_populates="product",
        order_by="ProductSubscriptionPlan.display_order",
        cascade="all, delete-orphan",
    )


class ProductOptionGroup(Base):
    __tablename__ = "product_option_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    group_type = Column(
        SqlEnum(ProductOptionGroupTypeEnum, name="product_option_group_type_enum"),
        nullable=False,
        server_default=ProductOptionGroupTypeEnum.SINGLE.value,
    )
    is_required = Column(Boolean, nullable=False, server_default="false")
    display_order = Column(Integer, nullable=False, server_default="0")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="option_groups")
    options = relationship(
        "ProductOption",
        back_populates="group",
        order_by="ProductOption.display_order",
        cascade="all, delete-orphan",
    )


class ProductOption(Base):
    __tablename__ = "product_options"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("product_option_groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price_delta = Column(Numeric(10, 2), nullable=False, server_default="0")
    metadata_json = Column(JSON, nullable=True)
    display_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    group = relationship("ProductOptionGroup", back_populates="options")


class ProductAddOn(Base):
    __tablename__ = "product_add_ons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price_delta = Column(Numeric(10, 2), nullable=False, server_default="0")
    is_recommended = Column(Boolean, nullable=False, server_default="false")
    display_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="add_ons")


class ProductCustomField(Base):
    __tablename__ = "product_custom_fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)
    field_type = Column(
        SqlEnum(ProductCustomFieldTypeEnum, name="product_custom_field_type_enum"),
        nullable=False,
        server_default=ProductCustomFieldTypeEnum.TEXT.value,
    )
    placeholder = Column(String, nullable=True)
    help_text = Column(Text, nullable=True)
    is_required = Column(Boolean, nullable=False, server_default="false")
    display_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="custom_fields")


class ProductSubscriptionPlan(Base):
    __tablename__ = "product_subscription_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    billing_cycle = Column(
        SqlEnum(ProductSubscriptionBillingCycleEnum, name="product_subscription_billing_cycle_enum"),
        nullable=False,
        server_default=ProductSubscriptionBillingCycleEnum.ONE_TIME.value,
    )
    price_multiplier = Column(Numeric(10, 2), nullable=True)
    price_delta = Column(Numeric(10, 2), nullable=True)
    is_default = Column(Boolean, nullable=False, server_default="false")
    display_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="subscription_plans")
