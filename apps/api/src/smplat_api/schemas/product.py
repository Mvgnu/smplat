from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, model_validator

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.domain.fulfillment import get_provider, get_service, service_exists


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


class JourneyComponentTrigger(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    stage: str
    event: str
    channel: str | None = None
    preset_id: str | None = Field(None, alias="presetId")
    journey_tag: str | None = Field(None, alias="journeyTag")
    metadata: dict | None = Field(None, alias="metadata")


class JourneyComponentFieldOption(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    label: str
    value: str | int | float | bool
    description: str | None = Field(None, alias="description")


class JourneyComponentSchemaField(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    key: str
    label: str
    type: str
    required: bool | None = None
    placeholder: str | None = None
    helper_text: str | None = Field(None, alias="helperText")
    default_value: str | int | float | bool | None = Field(None, alias="defaultValue")
    options: list[JourneyComponentFieldOption] | None = None
    validation: dict | None = None


class JourneyComponentSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    version: int | None = None
    fields: list[JourneyComponentSchemaField] = Field(default_factory=list)
    notes: str | None = None


class JourneyComponentProviderDependency(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    provider_id: str = Field(..., alias="providerId")
    service_id: str | None = Field(None, alias="serviceId")
    scopes: list[str] | None = None
    secrets: list[str] | None = None


class JourneyComponentRetryPolicy(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    max_attempts: int = Field(..., alias="maxAttempts")
    backoff_seconds: int | None = Field(None, alias="backoffSeconds")
    strategy: str | None = None


class JourneyComponentBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    key: str
    name: str
    description: str | None = None
    triggers: list[JourneyComponentTrigger] = Field(default_factory=list)
    script_slug: str = Field(..., alias="scriptSlug")
    script_version: str | None = Field(None, alias="scriptVersion")
    script_runtime: str | None = Field(None, alias="scriptRuntime")
    script_entrypoint: str | None = Field(None, alias="scriptEntrypoint")
    input_schema: JourneyComponentSchema = Field(..., alias="inputSchema")
    output_schema: JourneyComponentSchema | None = Field(None, alias="outputSchema")
    provider_dependencies: list[JourneyComponentProviderDependency] = Field(
        default_factory=list, alias="providerDependencies"
    )
    timeout_seconds: int | None = Field(None, alias="timeoutSeconds")
    retry_policy: JourneyComponentRetryPolicy | None = Field(None, alias="retryPolicy")
    telemetry_labels: dict | None = Field(None, alias="telemetryLabels")
    tags: list[str] = Field(default_factory=list, alias="tags")
    metadata_json: dict | None = Field(
        None,
        alias="metadata",
        validation_alias=AliasChoices("metadata_json", "metadata"),
    )


class JourneyComponentCreate(JourneyComponentBase):
    pass


class JourneyComponentUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    key: str | None = None
    name: str | None = None
    description: str | None = None
    triggers: list[JourneyComponentTrigger] | None = None
    script_slug: str | None = Field(None, alias="scriptSlug")
    script_version: str | None = Field(None, alias="scriptVersion")
    script_runtime: str | None = Field(None, alias="scriptRuntime")
    script_entrypoint: str | None = Field(None, alias="scriptEntrypoint")
    input_schema: JourneyComponentSchema | None = Field(None, alias="inputSchema")
    output_schema: JourneyComponentSchema | None = Field(None, alias="outputSchema")
    provider_dependencies: list[JourneyComponentProviderDependency] | None = Field(
        None, alias="providerDependencies"
    )
    timeout_seconds: int | None = Field(None, alias="timeoutSeconds")
    retry_policy: JourneyComponentRetryPolicy | None = Field(None, alias="retryPolicy")
    telemetry_labels: dict | None = Field(None, alias="telemetryLabels")
    tags: list[str] | None = Field(None, alias="tags")
    metadata_json: dict | None = Field(
        None,
        serialization_alias="metadata",
        validation_alias=AliasChoices("metadata_json", "metadata"),
    )


class JourneyComponentDefinition(JourneyComponentBase):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True, extra="allow")

    id: UUID
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class JourneyComponentStaticBinding(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["static"]
    input_key: str = Field(..., alias="inputKey")
    value: str | int | float | bool | None = Field(None, alias="value")


class JourneyComponentProductFieldBinding(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["product_field"]
    input_key: str = Field(..., alias="inputKey")
    path: str
    required: bool | None = None


class JourneyComponentRuntimeBinding(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["runtime"]
    input_key: str = Field(..., alias="inputKey")
    source: str
    required: bool | None = None


JourneyComponentInputBinding = Annotated[
    JourneyComponentStaticBinding | JourneyComponentProductFieldBinding | JourneyComponentRuntimeBinding,
    Field(discriminator="kind"),
]


class ProductJourneyComponentResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    product_id: UUID = Field(..., alias="productId")
    component_id: UUID = Field(..., alias="componentId")
    display_order: int = Field(..., alias="displayOrder")
    channel_eligibility: list[str] | None = Field(None, alias="channelEligibility")
    is_required: bool = Field(False, alias="isRequired")
    bindings: list[JourneyComponentInputBinding] = Field(default_factory=list, alias="bindings")
    metadata_json: dict | None = Field(
        None,
        alias="metadata",
        validation_alias=AliasChoices("metadata_json", "metadata"),
    )
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")
    component: JourneyComponentDefinition | None = Field(None, alias="component")


class JourneyComponentRunStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JourneyComponentRunResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    run_token: str = Field(..., alias="runToken")
    product_id: UUID | None = Field(None, alias="productId")
    product_component_id: UUID | None = Field(None, alias="productComponentId")
    component_id: UUID = Field(..., alias="componentId")
    channel: str | None = Field(None, alias="channel")
    trigger: dict | JourneyComponentTrigger | None = Field(None, alias="trigger")
    input_payload: dict | None = Field(None, alias="inputPayload")
    binding_snapshot: list[JourneyComponentInputBinding] | dict | None = Field(None, alias="bindingSnapshot")
    metadata_json: dict | None = Field(
        None,
        alias="metadata",
        validation_alias=AliasChoices("metadata_json", "metadata"),
    )
    context: dict | None = Field(None, alias="context")
    telemetry_json: dict | None = Field(
        None,
        alias="telemetry",
        validation_alias=AliasChoices("telemetry_json", "telemetry"),
    )
    status: JourneyComponentRunStatus
    attempts: int = Field(..., alias="attempts")
    error_message: str | None = Field(None, alias="errorMessage")
    result_payload: dict | None = Field(None, alias="resultPayload")
    queued_at: datetime | None = Field(None, alias="queuedAt")
    started_at: datetime | None = Field(None, alias="startedAt")
    completed_at: datetime | None = Field(None, alias="completedAt")
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class JourneyComponentHealthSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    component_id: UUID = Field(..., alias="componentId")
    product_component_id: UUID | None = Field(None, alias="productComponentId")
    run_count: int = Field(0, alias="runCount", ge=0)
    success_count: int = Field(0, alias="successCount", ge=0)
    failure_count: int = Field(0, alias="failureCount", ge=0)
    last_run: JourneyComponentRunResponse | None = Field(None, alias="lastRun")


class JourneyComponentRunCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    component_id: UUID = Field(..., alias="componentId")
    product_id: UUID | None = Field(None, alias="productId")
    product_component_id: UUID | None = Field(None, alias="productComponentId")
    channel: str | None = Field(None, alias="channel")
    trigger: JourneyComponentTrigger | None = Field(None, alias="trigger")
    input_payload: dict | None = Field(None, alias="inputPayload")
    bindings: list[JourneyComponentInputBinding] | None = Field(None, alias="bindings")
    metadata: dict | None = Field(None, alias="metadata")
    context: dict | None = Field(None, alias="context")


class ProductJourneyRuntimeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product_id: UUID = Field(..., alias="productId")
    slug: str
    title: str
    journey_components: list[ProductJourneyComponentResponse] = Field(default_factory=list, alias="journeyComponents")
    recent_runs: list[JourneyComponentRunResponse] = Field(default_factory=list, alias="recentRuns")
    component_health: list[JourneyComponentHealthSummaryResponse] = Field(
        default_factory=list,
        alias="componentHealth",
    )


class ProductJourneyComponentWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    component_id: UUID = Field(..., alias="componentId")
    display_order: int | None = Field(None, alias="displayOrder", ge=0)
    channel_eligibility: list[str] | None = Field(None, alias="channelEligibility")
    is_required: bool | None = Field(None, alias="isRequired")
    bindings: list[JourneyComponentInputBinding] = Field(default_factory=list, alias="bindings")
    metadata: dict | None = Field(None, alias="metadata")


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
    channel_eligibility: list[str] = Field(default_factory=list, alias="channelEligibility")
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class ProductMediaAssetResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    client_id: str | None = Field(None, alias="clientId")
    label: str | None = None
    asset_url: str = Field(..., alias="assetUrl")
    storage_key: str | None = Field(None, alias="storageKey")
    usage_tags: list[str] | None = Field(None, alias="usageTags")
    alt_text: str | None = Field(None, alias="altText")
    display_order: int = Field(0, alias="displayOrder")
    is_primary: bool = Field(False, alias="isPrimary")
    checksum: str | None = Field(None, alias="checksum")
    metadata_json: dict | None = Field(None, alias="metadata")
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class ProductAuditAction(str, Enum):
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"
    RESTORED = "restored"


class ProductAuditLogEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    action: ProductAuditAction
    actor_email: str | None = Field(None, alias="actorEmail")
    before_snapshot: dict | None = Field(None, alias="beforeSnapshot")
    after_snapshot: dict | None = Field(None, alias="afterSnapshot")
    created_at: datetime | None = Field(None, alias="createdAt")


class ProductOptionDiscountTier(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    min_amount: float = Field(..., alias="minAmount", gt=0)
    unit_price: float = Field(..., alias="unitPrice")
    label: str | None = Field(None, alias="label")


class ProductOptionMediaAttachment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    asset_id: str = Field(..., alias="assetId", min_length=1)
    client_id: str | None = Field(None, alias="clientId")
    display_order: int | None = Field(None, alias="displayOrder", ge=0)
    is_primary: bool | None = Field(None, alias="isPrimary")
    usage: str | None = Field(None, alias="usage")
    usage_tags: list[str] | None = Field(None, alias="usageTags")
    label: str | None = Field(None, alias="label")
    alt_text: str | None = Field(None, alias="altText")
    storage_key: str | None = Field(None, alias="storageKey")
    checksum: str | None = Field(None, alias="checksum")


class ProductOptionStructuredPricing(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    amount: float = Field(..., alias="amount", gt=0)
    amount_unit: str = Field(..., alias="amountUnit", min_length=1)
    base_price: float = Field(..., alias="basePrice")
    unit_price: float = Field(..., alias="unitPrice")
    drip_min_per_day: float | None = Field(None, alias="dripMinPerDay", ge=0)
    discount_tiers: list[ProductOptionDiscountTier] | None = Field(None, alias="discountTiers")


class ProductOptionCalculatorMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    expression: str
    sample_amount: float | None = Field(None, alias="sampleAmount")
    sample_days: float | None = Field(None, alias="sampleDays")


class ProductOptionMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    structured_pricing: ProductOptionStructuredPricing | None = Field(None, alias="structuredPricing")
    media: list[ProductOptionMediaAttachment] | None = Field(None, alias="media")
    recommended: bool | None = Field(None, alias="recommended")
    marketing_tagline: str | None = Field(None, alias="marketingTagline")
    fulfillment_sla: str | None = Field(None, alias="fulfillmentSla")
    hero_image_url: str | None = Field(None, alias="heroImageUrl")
    calculator: ProductOptionCalculatorMetadata | None = Field(None, alias="calculator")


class ProductCustomFieldRegexRule(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    pattern: str
    flags: str | None = Field(None, alias="flags")
    description: str | None = Field(None, alias="description")
    sample_value: str | None = Field(None, alias="sampleValue")


class ProductCustomFieldValidationRules(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    min_length: int | None = Field(None, alias="minLength", ge=0)
    max_length: int | None = Field(None, alias="maxLength", ge=0)
    min_value: float | None = Field(None, alias="minValue")
    max_value: float | None = Field(None, alias="maxValue")
    pattern: str | None = Field(None, alias="pattern")
    regex: ProductCustomFieldRegexRule | None = Field(None, alias="regex")
    disallow_whitespace: bool | None = Field(None, alias="disallowWhitespace")
    numeric_step: float | None = Field(None, alias="numericStep", gt=0)
    allowed_values: list[str] | None = Field(None, alias="allowedValues")


class CustomFieldOptionCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["option"]
    option_id: str | None = Field(None, alias="optionId")
    option_key: str | None = Field(None, alias="optionKey")
    group_id: str | None = Field(None, alias="groupId")
    group_key: str | None = Field(None, alias="groupKey")


class CustomFieldAddOnCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["addOn"]
    add_on_id: str | None = Field(None, alias="addOnId")
    add_on_key: str | None = Field(None, alias="addOnKey")


class CustomFieldSubscriptionPlanCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["subscriptionPlan"]
    plan_id: str | None = Field(None, alias="planId")
    plan_key: str | None = Field(None, alias="planKey")


class CustomFieldChannelConditionSingle(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["channel"]
    channel: str


CustomFieldVisibilityCondition = Annotated[
    CustomFieldOptionCondition
    | CustomFieldAddOnCondition
    | CustomFieldSubscriptionPlanCondition
    | CustomFieldChannelConditionSingle,
    Field(discriminator="kind"),
]


class ProductCustomFieldVisibilityRules(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    mode: Literal["all", "any"] = Field(default="all", alias="mode")
    conditions: list[CustomFieldVisibilityCondition] = Field(default_factory=list, alias="conditions")


class ProductCustomFieldPassthrough(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    checkout: bool | None = Field(None, alias="checkout")
    fulfillment: bool | None = Field(None, alias="fulfillment")


class ProductCustomFieldRegexTester(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    sample_value: str | None = Field(None, alias="sampleValue")
    last_result: bool | None = Field(None, alias="lastResult")


class ProductCustomFieldMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    helper_text: str | None = Field(None, alias="helperText")
    sample_values: list[str] | None = Field(None, alias="sampleValues")
    validation: ProductCustomFieldValidationRules | None = Field(None, alias="validation")
    validation_rules: ProductCustomFieldValidationRules | None = Field(None, alias="validationRules")
    default_value: str | None = Field(None, alias="defaultValue")
    passthrough: ProductCustomFieldPassthrough | None = Field(None, alias="passthrough")
    conditional_visibility: ProductCustomFieldVisibilityRules | None = Field(
        None, alias="conditionalVisibility"
    )
    visibility_rules: ProductCustomFieldVisibilityRules | None = Field(None, alias="visibilityRules")
    regex_tester: ProductCustomFieldRegexTester | None = Field(None, alias="regexTester")

    @model_validator(mode="after")
    def sync_aliases(self) -> "ProductCustomFieldMetadata":
        if self.validation_rules is None and self.validation is not None:
            self.validation_rules = self.validation
        elif self.validation is None and self.validation_rules is not None:
            self.validation = self.validation_rules

        if self.visibility_rules is None and self.conditional_visibility is not None:
            self.visibility_rules = self.conditional_visibility
        elif self.conditional_visibility is None and self.visibility_rules is not None:
            self.conditional_visibility = self.visibility_rules

        return self


class ProductConfigurationPresetSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    option_selections: dict[str, list[str]] = Field(default_factory=dict, alias="optionSelections")
    add_on_ids: list[str] = Field(default_factory=list, alias="addOnIds")
    subscription_plan_id: str | None = Field(None, alias="subscriptionPlanId")
    custom_field_values: dict[str, str] = Field(default_factory=dict, alias="customFieldValues")


class ProductConfigurationPreset(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: UUID | None = Field(None, alias="id")
    label: str
    summary: str | None = Field(None, alias="summary")
    hero_image_url: str | None = Field(None, alias="heroImageUrl")
    badge: str | None = Field(None, alias="badge")
    price_hint: str | None = Field(None, alias="priceHint")
    display_order: int | None = Field(0, alias="displayOrder")
    selection: ProductConfigurationPresetSelection


class ChannelCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["channel"]
    channels: list[str]


class GeoCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["geo"]
    regions: list[str]


class OptionCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["option"]
    option_id: str | None = Field(None, alias="optionId")
    option_key: str | None = Field(None, alias="optionKey")


class AmountCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["amount"]
    min: float | None = Field(None, alias="min")
    max: float | None = Field(None, alias="max")


class DripCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["drip"]
    min: float | None = Field(None, alias="min")
    max: float | None = Field(None, alias="max")


ServiceOverrideCondition = Annotated[
    ChannelCondition | GeoCondition | OptionCondition | AmountCondition | DripCondition,
    Field(discriminator="kind"),
]


class ServiceOverrideRuleOverrides(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    service_id: str | None = Field(None, alias="serviceId")
    provider_id: str | None = Field(None, alias="providerId")
    cost_amount: float | None = Field(None, alias="costAmount")
    cost_currency: str | None = Field(None, alias="costCurrency")
    margin_target: float | None = Field(None, alias="marginTarget")
    fulfillment_mode: Literal["immediate", "scheduled", "refill"] | None = Field(
        None, alias="fulfillmentMode"
    )
    payload_template: dict[str, Any] | None = Field(None, alias="payloadTemplate")
    drip_per_day: float | None = Field(None, alias="dripPerDay")
    preview_quantity: float | None = Field(None, alias="previewQuantity")


class ServiceOverrideRule(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    label: str | None = Field(None, alias="label")
    description: str | None = Field(None, alias="description")
    priority: float | None = Field(None, alias="priority")
    conditions: list[ServiceOverrideCondition]
    overrides: ServiceOverrideRuleOverrides = Field(default_factory=ServiceOverrideRuleOverrides)

    @model_validator(mode="after")
    def ensure_conditions(self) -> "ServiceOverrideRule":
        if not self.conditions:
            raise ValueError("Service override rule requires at least one condition.")
        return self


class ProductAddOnPricing(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    mode: Literal["flat", "percentage", "serviceOverride"] = Field(..., alias="mode")
    amount: float | None = Field(None, alias="amount", ge=0)
    service_id: str | None = Field(None, alias="serviceId")
    provider_id: str | None = Field(None, alias="providerId")
    cost_amount: float | None = Field(None, alias="costAmount")
    cost_currency: str | None = Field(None, alias="costCurrency")
    margin_target: float | None = Field(None, alias="marginTarget")
    fulfillment_mode: Literal["immediate", "scheduled", "refill"] | None = Field(None, alias="fulfillmentMode")
    payload_template: dict[str, Any] | None = Field(None, alias="payloadTemplate")
    drip_per_day: float | None = Field(None, alias="dripPerDay")
    preview_quantity: float | None = Field(None, alias="previewQuantity")
    rules: list[ServiceOverrideRule] | None = Field(None, alias="rules")

    @model_validator(mode="after")
    def validate_configuration(self) -> "ProductAddOnPricing":
        if self.mode == "flat":
            if self.amount is None:
                raise ValueError("Flat pricing requires an amount.")
            if self.amount < 0:
                raise ValueError("Flat pricing amount must be non-negative.")
        elif self.mode == "percentage":
            if self.amount is None:
                raise ValueError("Percentage pricing requires an amount.")
            if not 0 <= self.amount <= 1:
                raise ValueError("Percentage pricing requires an amount between 0 and 1.")
        elif self.mode == "serviceOverride":
            if not self.service_id:
                raise ValueError("Service override pricing requires serviceId.")
            if not service_exists(self.service_id):
                raise ValueError(f"Unknown fulfillment service override: {self.service_id}")
        return self


class ProductAddOnMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    pricing: ProductAddOnPricing | None = Field(None, alias="pricing")


class ProductAddOnPricingSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    mode: Literal["flat", "percentage", "serviceOverride"]
    amount: float | None = Field(None, alias="amount")
    percentage_multiplier: float | None = Field(None, alias="percentageMultiplier")
    service_id: str | None = Field(None, alias="serviceId")
    service_action: str | None = Field(None, alias="serviceAction")
    service_provider_id: str | None = Field(None, alias="serviceProviderId")
    service_provider_name: str | None = Field(None, alias="serviceProviderName")
    service_descriptor: dict[str, Any] | None = Field(None, alias="serviceDescriptor")
    provider_cost_amount: float | None = Field(None, alias="providerCostAmount")
    provider_cost_currency: str | None = Field(None, alias="providerCostCurrency")
    margin_target: float | None = Field(None, alias="marginTarget")
    fulfillment_mode: Literal["immediate", "scheduled", "refill"] | None = Field(None, alias="fulfillmentMode")
    payload_template: dict[str, Any] | None = Field(None, alias="payloadTemplate")
    drip_per_day: float | None = Field(None, alias="dripPerDay")
    preview_quantity: float | None = Field(None, alias="previewQuantity")
    service_rules: list[ServiceOverrideRule] | None = Field(None, alias="serviceRules")


class ProductOptionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str = Field(..., alias="name")
    description: str | None = None
    price_delta: float = Field(..., alias="priceDelta")
    metadata_json: ProductOptionMetadata | None = Field(None, alias="metadataJson")
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
    metadata_json: ProductAddOnMetadata | None = Field(None, alias="metadataJson")
    pricing: ProductAddOnPricingSnapshot | None = Field(default=None, alias="pricing")
    computed_delta: float = Field(default=0.0, alias="computedDelta")
    percentage_multiplier: float | None = Field(default=None, alias="percentageMultiplier")

    @model_validator(mode="before")
    @classmethod
    def _derive_pricing(cls, data: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(data, dict):
            if hasattr(data, "model_dump"):
                data = data.model_dump(by_alias=True)  # type: ignore[attr-defined]
            elif hasattr(data, "__dict__"):
                data = dict(data.__dict__)
            else:
                data = dict(data or {})
        price_delta_raw = data.get("priceDelta", data.get("price_delta", 0)) or 0
        fallback_delta = float(price_delta_raw)
        metadata = data.get("metadataJson") or data.get("metadata_json")
        pricing_snapshot, computed_delta, multiplier = _build_add_on_pricing_snapshot(metadata, fallback_delta)
        if pricing_snapshot is not None:
            data["pricing"] = pricing_snapshot
        data["computedDelta"] = computed_delta
        data["percentageMultiplier"] = multiplier
        return data


class ProductCustomFieldResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    label: str
    field_type: ProductCustomFieldType = Field(..., alias="fieldType")
    placeholder: str | None = None
    help_text: str | None = Field(None, alias="helpText")
    is_required: bool = Field(..., alias="isRequired")
    display_order: int = Field(..., alias="displayOrder")
    metadata_json: ProductCustomFieldMetadata | None = Field(None, alias="metadataJson")


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
    media_assets: list[ProductMediaAssetResponse] = Field(default_factory=list, alias="mediaAssets")
    audit_log: list[ProductAuditLogEntry] = Field(default_factory=list, alias="auditLog")
    configuration_presets: list[ProductConfigurationPreset] = Field(
        default_factory=list, alias="configurationPresets"
    )
    journey_components: list[ProductJourneyComponentResponse] = Field(
        default_factory=list, alias="journeyComponents"
    )


class ProductOptionWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    name: str
    description: str | None = None
    price_delta: float = Field(0.0, alias="priceDelta", ge=-100000, le=100000)
    metadata: ProductOptionMetadata | None = Field(None, alias="metadata")
    display_order: int = Field(0, alias="displayOrder", ge=0)


class ProductOptionGroupWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    name: str
    description: str | None = None
    group_type: ProductOptionGroupType = Field(..., alias="groupType")
    is_required: bool = Field(False, alias="isRequired")
    display_order: int = Field(0, alias="displayOrder", ge=0)
    metadata: dict | None = Field(None, alias="metadata")
    options: list[ProductOptionWrite] = Field(default_factory=list, alias="options")


class ProductAddOnWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    label: str
    description: str | None = None
    price_delta: float = Field(0.0, alias="priceDelta", ge=-100000, le=100000)
    is_recommended: bool = Field(False, alias="isRecommended")
    display_order: int = Field(0, alias="displayOrder", ge=0)
    metadata: ProductAddOnMetadata | None = Field(None, alias="metadata")


def _build_add_on_pricing_snapshot(
    metadata: ProductAddOnMetadata | dict[str, Any] | None,
    fallback_delta: float,
) -> tuple[dict[str, Any] | None, float, float | None]:
    """Return normalized pricing snapshot, computed delta, and multiplier."""

    pricing_model: ProductAddOnPricing | None = None
    if isinstance(metadata, ProductAddOnMetadata):
        pricing_model = metadata.pricing
    elif isinstance(metadata, dict):
        raw_pricing = metadata.get("pricing")
        if isinstance(raw_pricing, dict):
            try:
                pricing_model = ProductAddOnPricing.model_validate(raw_pricing)
            except ValidationError:
                pricing_model = None

    if pricing_model is None:
        return None, float(fallback_delta), None

    mode = pricing_model.mode
    amount = pricing_model.amount
    service_id = pricing_model.service_id
    computed_delta = float(fallback_delta)
    multiplier: float | None = None

    payload: dict[str, Any] = {"mode": mode}
    if amount is not None:
        payload["amount"] = float(amount)

    if mode == "flat":
        if amount is not None:
            computed_delta = float(amount)
    elif mode == "percentage":
        multiplier = float(amount) if amount is not None else None
        if multiplier is not None:
            payload["percentageMultiplier"] = multiplier
    elif mode == "serviceOverride":
        if service_id:
            payload["serviceId"] = service_id
            descriptor = get_service(service_id)
            if descriptor:
                payload["serviceAction"] = descriptor.action
                payload["serviceProviderId"] = descriptor.provider_id
                provider = get_provider(descriptor.provider_id)
                if provider:
                    payload["serviceProviderName"] = provider.name
                payload["serviceDescriptor"] = descriptor.as_payload()
        if pricing_model.provider_id:
            payload["serviceProviderId"] = pricing_model.provider_id
        if amount is not None:
            computed_delta = float(amount)
        if pricing_model.cost_amount is not None:
            payload["providerCostAmount"] = float(pricing_model.cost_amount)
        if pricing_model.cost_currency:
            payload["providerCostCurrency"] = pricing_model.cost_currency.upper()
        if pricing_model.margin_target is not None:
            payload["marginTarget"] = float(pricing_model.margin_target)
        if pricing_model.fulfillment_mode:
            payload["fulfillmentMode"] = pricing_model.fulfillment_mode
        if pricing_model.payload_template:
            payload["payloadTemplate"] = pricing_model.payload_template
        if pricing_model.drip_per_day is not None:
            payload["dripPerDay"] = float(pricing_model.drip_per_day)
        if pricing_model.preview_quantity is not None:
            payload["previewQuantity"] = float(pricing_model.preview_quantity)
        if pricing_model.rules:
            payload["serviceRules"] = [
                rule.model_dump(by_alias=True, exclude_unset=True) for rule in pricing_model.rules
            ]

    # Remove None values for clean payload
    payload = {key: value for key, value in payload.items() if value is not None}
    return payload or None, computed_delta, multiplier


class ProductCustomFieldWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    label: str
    field_type: ProductCustomFieldType = Field(..., alias="fieldType")
    placeholder: str | None = None
    help_text: str | None = Field(None, alias="helpText")
    is_required: bool = Field(False, alias="isRequired")
    display_order: int = Field(0, alias="displayOrder", ge=0)
    metadata: ProductCustomFieldMetadata | None = Field(None, alias="metadata")


class ProductSubscriptionPlanWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID | None = Field(None, alias="id")
    label: str
    description: str | None = None
    billing_cycle: ProductSubscriptionBillingCycle = Field(..., alias="billingCycle")
    price_multiplier: float | None = Field(None, alias="priceMultiplier", ge=0)
    price_delta: float | None = Field(None, alias="priceDelta", ge=-100000, le=100000)
    is_default: bool = Field(False, alias="isDefault")
    display_order: int = Field(0, alias="displayOrder", ge=0)


class ProductConfigurationMutation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    option_groups: list[ProductOptionGroupWrite] | None = Field(None, alias="optionGroups")
    add_ons: list[ProductAddOnWrite] | None = Field(None, alias="addOns")
    custom_fields: list[ProductCustomFieldWrite] | None = Field(None, alias="customFields")
    subscription_plans: list[ProductSubscriptionPlanWrite] | None = Field(
        None, alias="subscriptionPlans"
    )
    configuration_presets: list[ProductConfigurationPreset] | None = Field(
        None, alias="configurationPresets"
    )
    journey_components: list[ProductJourneyComponentWrite] | None = Field(
        None, alias="journeyComponents"
    )


class ProductCreate(BaseModel):
    slug: str
    title: str
    description: str | None = None
    category: str
    base_price: float = Field(..., alias="basePrice")
    currency: CurrencyEnum
    status: ProductStatus = ProductStatus.DRAFT
    channel_eligibility: list[str] = Field(default_factory=list, alias="channelEligibility")
    configuration: ProductConfigurationMutation | None = Field(None, alias="configuration")


class ProductUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    base_price: float | None = Field(None, alias="basePrice")
    currency: CurrencyEnum | None = None
    status: ProductStatus | None = None
    channel_eligibility: list[str] | None = Field(None, alias="channelEligibility")
    configuration: ProductConfigurationMutation | None = Field(None, alias="configuration")


class ProductAssetCreate(BaseModel):
    label: str | None = None
    asset_url: str = Field(..., alias="assetUrl")
    storage_key: str | None = Field(None, alias="storageKey")
    client_id: str | None = Field(None, alias="clientId")
    display_order: int | None = Field(None, alias="displayOrder", ge=0)
    is_primary: bool | None = Field(None, alias="isPrimary")
    usage_tags: list[str] | None = Field(None, alias="usageTags")
    alt_text: str | None = Field(None, alias="altText")
    checksum: str | None = Field(None, alias="checksum")
    metadata: dict | None = None
