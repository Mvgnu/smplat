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
    channel_eligibility = Column(JSON, nullable=False, default=list)
    fulfillment_config = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    option_groups = relationship(
        "ProductOptionGroup",
        back_populates="product",
        order_by="ProductOptionGroup.display_order",
        cascade="all, delete-orphan",
    )
    media_assets = relationship(
        "ProductMediaAsset",
        back_populates="product",
        order_by="ProductMediaAsset.created_at.desc()",
        cascade="all, delete-orphan",
    )
    audit_logs = relationship(
        "ProductAuditLog",
        back_populates="product",
        order_by="ProductAuditLog.created_at.desc()",
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

    @property
    def fulfillment_summary(self) -> dict | None:
        """Return structured fulfillment assurances derived from configuration."""

        config = self.fulfillment_config or {}
        if not isinstance(config, dict):
            return None

        delivery_config = config.get("delivery") or {}
        assurances_config = config.get("assurances") or []
        support_config = config.get("support") or []

        def _as_int(value: object) -> int | None:
            try:
                if isinstance(value, bool):
                    return int(value)
                if isinstance(value, (int, float)):
                    return int(value)
                if isinstance(value, str) and value.strip():
                    return int(float(value))
            except Exception:  # pragma: no cover - defensive conversion
                return None
            return None

        def _as_str(value: object) -> str | None:
            if isinstance(value, str) and value.strip():
                return value.strip()
            return None

        def _extract_delivery(raw: dict | None) -> dict | None:
            if not isinstance(raw, dict):
                return None

            return {
                "minDays": _as_int(raw.get("minDays") or raw.get("min_days")),
                "maxDays": _as_int(raw.get("maxDays") or raw.get("max_days")),
                "averageDays": _as_int(raw.get("averageDays") or raw.get("average_days")),
                "confidence": _as_str(raw.get("confidence")),
                "headline": _as_str(raw.get("headline")),
                "narrative": _as_str(raw.get("narrative")),
            }

        def _extract_assurances(raw_list: list | None) -> list[dict]:
            items: list[dict] = []
            if not isinstance(raw_list, list):
                return items
            for entry in raw_list:
                if not isinstance(entry, dict):
                    continue
                label = _as_str(entry.get("label"))
                description = _as_str(entry.get("description"))
                if not label and not description:
                    continue
                items.append(
                    {
                        "id": _as_str(entry.get("id")) or label or "assurance",
                        "label": label or description or "",
                        "description": description,
                        "evidence": _as_str(entry.get("evidence")),
                        "source": _as_str(entry.get("source")),
                    }
                )
            return items

        def _extract_support(raw_list: list | None) -> list[dict]:
            items: list[dict] = []
            if not isinstance(raw_list, list):
                return items
            for entry in raw_list:
                if not isinstance(entry, dict):
                    continue
                channel = _as_str(entry.get("channel")) or _as_str(entry.get("type"))
                label = _as_str(entry.get("label")) or channel
                target = _as_str(entry.get("target")) or _as_str(entry.get("href"))
                if not channel or not label or not target:
                    continue
                items.append(
                    {
                        "id": _as_str(entry.get("id")) or f"{channel}:{target}",
                        "channel": channel,
                        "label": label,
                        "target": target,
                        "availability": _as_str(entry.get("availability")),
                    }
                )
            return items

        summary: dict[str, object] = {}
        delivery = _extract_delivery(delivery_config)
        assurances = _extract_assurances(assurances_config)
        support = _extract_support(support_config)

        if delivery and any(value is not None for value in delivery.values()):
            summary["delivery"] = delivery
        if assurances:
            summary["assurances"] = assurances
        if support:
            summary["support"] = support

        return summary or None


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


class ProductMediaAsset(Base):
    """Uploaded asset metadata associated with a product."""

    # meta: provenance: product-merchandising
    __tablename__ = "product_media_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(150), nullable=True)
    asset_url = Column(String(1024), nullable=False)
    storage_key = Column(String(512), nullable=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="media_assets")


class ProductAuditLog(Base):
    """Immutable audit log capturing product merchandising changes."""

    # meta: provenance: product-merchandising
    __tablename__ = "product_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    action = Column(String, nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email = Column(String(255), nullable=True)
    before_snapshot = Column(JSON, nullable=True)
    after_snapshot = Column(JSON, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    product = relationship("Product", back_populates="audit_logs")
