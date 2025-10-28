from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from smplat_api.models.customer_profile import CurrencyEnum


class ProductStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ProductOptionGroupType(str, Enum):
    SINGLE = "single"
    MULTIPLE = "multiple"


class ProductCustomFieldType(str, Enum):
    TEXT = "text"
    URL = "url"
    NUMBER = "number"


class ProductSubscriptionBillingCycle(str, Enum):
    ONE_TIME = "one_time"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"


class ProductDeliveryEstimate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    min_days: int | None = Field(None, alias="minDays")
    max_days: int | None = Field(None, alias="maxDays")
    average_days: int | None = Field(None, alias="averageDays")
    confidence: str | None = Field(None, alias="confidence")
    headline: str | None = Field(None, alias="headline")
    narrative: str | None = Field(None, alias="narrative")


class ProductAssurancePoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: str = Field(..., alias="id")
    label: str = Field(..., alias="label")
    description: str | None = Field(None, alias="description")
    evidence: str | None = Field(None, alias="evidence")
    source: str | None = Field(None, alias="source")


class ProductSupportChannel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: str
    channel: str
    label: str
    target: str
    availability: str | None = None


class ProductFulfillmentSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    delivery: ProductDeliveryEstimate | None = None
    assurances: list[ProductAssurancePoint] = Field(default_factory=list)
    support: list[ProductSupportChannel] = Field(default_factory=list)


class ProductResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    slug: str
    title: str
    description: str | None = None
    category: str
    base_price: float = Field(..., alias="basePrice")
    currency: str
    status: ProductStatus
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class ProductOptionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str = Field(..., alias="name")
    description: str | None = None
    price_delta: float = Field(..., alias="priceDelta")
    metadata_json: dict | None = Field(None, alias="metadataJson")
    display_order: int = Field(..., alias="displayOrder")


class ProductOptionGroupResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    group_type: ProductOptionGroupType = Field(..., alias="groupType")
    is_required: bool = Field(..., alias="isRequired")
    display_order: int = Field(..., alias="displayOrder")
    options: list[ProductOptionResponse] = Field(default_factory=list)


class ProductAddOnResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str
    description: str | None = None
    price_delta: float = Field(..., alias="priceDelta")
    is_recommended: bool = Field(..., alias="isRecommended")
    display_order: int = Field(..., alias="displayOrder")


class ProductCustomFieldResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str
    field_type: ProductCustomFieldType = Field(..., alias="fieldType")
    placeholder: str | None = None
    help_text: str | None = Field(None, alias="helpText")
    is_required: bool = Field(..., alias="isRequired")
    display_order: int = Field(..., alias="displayOrder")


class ProductSubscriptionPlanResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str
    description: str | None = None
    billing_cycle: ProductSubscriptionBillingCycle = Field(..., alias="billingCycle")
    price_multiplier: float | None = Field(None, alias="priceMultiplier")
    price_delta: float | None = Field(None, alias="priceDelta")
    is_default: bool = Field(..., alias="isDefault")
    display_order: int = Field(..., alias="displayOrder")


class ProductDetailResponse(ProductResponse):
    option_groups: list[ProductOptionGroupResponse] = Field(default_factory=list, alias="optionGroups")
    add_ons: list[ProductAddOnResponse] = Field(default_factory=list, alias="addOns")
    custom_fields: list[ProductCustomFieldResponse] = Field(default_factory=list, alias="customFields")
    subscription_plans: list[ProductSubscriptionPlanResponse] = Field(
        default_factory=list, alias="subscriptionPlans"
    )
    fulfillment_summary: ProductFulfillmentSummary | None = Field(
        default=None, alias="fulfillmentSummary"
    )


class ProductCreate(BaseModel):
    slug: str
    title: str
    description: str | None = None
    category: str
    base_price: float = Field(..., alias="basePrice")
    currency: CurrencyEnum
    status: ProductStatus = ProductStatus.DRAFT


class ProductUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    base_price: float | None = Field(None, alias="basePrice")
    currency: CurrencyEnum | None = None
    status: ProductStatus | None = None
