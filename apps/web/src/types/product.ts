import type {
  ServiceOverrideCondition as SharedServiceOverrideCondition,
  ServiceOverrideRule as SharedServiceOverrideRule,
} from "@smplat/types";

export type ServiceOverrideCondition = SharedServiceOverrideCondition;
export type ServiceOverrideRule = SharedServiceOverrideRule;

export type ProductOptionDiscountTier = {
  minAmount: number;
  unitPrice: number;
  label?: string | null;
};

export type ProductOptionStructuredPricing = {
  amount: number;
  amountUnit: string;
  basePrice: number;
  unitPrice: number;
  dripMinPerDay?: number | null;
  discountTiers?: ProductOptionDiscountTier[] | null;
};

export type ProductAssetUsageTag = "hero" | "detail" | "gallery" | "social" | (string & {});

export type ProductOptionMediaAttachment = {
  assetId: string;
  clientId?: string | null;
  displayOrder?: number | null;
  isPrimary?: boolean | null;
  usage?: string | null;
  usageTags?: ProductAssetUsageTag[] | null;
  label?: string | null;
  altText?: string | null;
  storageKey?: string | null;
  checksum?: string | null;
};

export type ProductOptionCalculatorMetadata = {
  expression: string;
  sampleAmount?: number | null;
  sampleDays?: number | null;
};

export type ProductOptionMetadata = {
  structuredPricing?: ProductOptionStructuredPricing | null;
  media?: ProductOptionMediaAttachment[] | null;
  recommended?: boolean;
  editorKey?: string;
  marketingTagline?: string | null;
  fulfillmentSla?: string | null;
  heroImageUrl?: string | null;
  calculator?: ProductOptionCalculatorMetadata | null;
} & Record<string, unknown>;

export type ServiceOverrideConfig = {
  providerId?: string | null;
  costAmount?: number | null;
  costCurrency?: string | null;
  marginTarget?: number | null;
  fulfillmentMode?: "immediate" | "scheduled" | "refill";
  payloadTemplate?: Record<string, unknown> | null;
  dripPerDay?: number | null;
  previewQuantity?: number | null;
  rules?: ServiceOverrideRule[] | null;
};

export type ProductAddOnPricing =
  | { mode: "flat"; amount: number }
  | { mode: "percentage"; amount: number }
  | ({ mode: "serviceOverride"; serviceId: string; amount?: number | null } & ServiceOverrideConfig);

export type ProductAddOnMetadata = {
  pricing?: ProductAddOnPricing | null;
  editorKey?: string;
} & Record<string, unknown>;

export type ProductAddOnPricingSnapshot = {
  mode: "flat" | "percentage" | "serviceOverride";
  amount?: number | null;
  percentageMultiplier?: number | null;
  serviceId?: string | null;
  serviceAction?: string | null;
  serviceProviderId?: string | null;
  serviceProviderName?: string | null;
  serviceDescriptor?: Record<string, unknown> | null;
  providerCostAmount?: number | null;
  providerCostCurrency?: string | null;
  marginTarget?: number | null;
  fulfillmentMode?: "immediate" | "scheduled" | "refill";
  payloadTemplate?: Record<string, unknown> | null;
  dripPerDay?: number | null;
  previewQuantity?: number | null;
  serviceRules?: ServiceOverrideRule[] | null;
};

export type ProductOption = {
  id: string;
  label: string;
  description?: string | null;
  priceDelta: number;
  metadataJson?: ProductOptionMetadata | null;
  displayOrder: number;
};

export type ProductOptionGroup = {
  id: string;
  name: string;
  description?: string | null;
  groupType: "single" | "multiple";
  isRequired: boolean;
  displayOrder: number;
  metadataJson?: Record<string, unknown> | null;
  options: ProductOption[];
};

export type ProductAddOn = {
  id: string;
  label: string;
  description?: string | null;
  priceDelta: number;
  isRecommended: boolean;
  displayOrder: number;
  metadataJson?: ProductAddOnMetadata | null;
  pricing?: ProductAddOnPricingSnapshot | null;
  computedDelta: number;
  percentageMultiplier?: number | null;
};

export type CustomFieldVisibilityCondition =
  | { kind: "option"; optionId?: string; optionKey?: string; groupId?: string; groupKey?: string }
  | { kind: "addOn"; addOnId?: string; addOnKey?: string }
  | { kind: "subscriptionPlan"; planId?: string; planKey?: string }
  | { kind: "channel"; channel: string };

export type ProductCustomFieldRegexRule = {
  pattern: string;
  flags?: string;
  description?: string | null;
  sampleValue?: string | null;
};

export type ProductCustomFieldValidationRules = {
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  regex?: ProductCustomFieldRegexRule | null;
  disallowWhitespace?: boolean;
  numericStep?: number;
  allowedValues?: string[];
};

export type ProductCustomFieldVisibilityRules = {
  mode: "all" | "any";
  conditions: CustomFieldVisibilityCondition[];
};

export type ProductCustomFieldMetadata = {
  helperText?: string | null;
  sampleValues?: string[] | null;
  validationRules?: ProductCustomFieldValidationRules | null;
  validation?: ProductCustomFieldValidationRules | null;
  defaultValue?: string | null;
  passthrough?: {
    checkout?: boolean;
    fulfillment?: boolean;
  } | null;
  visibilityRules?: ProductCustomFieldVisibilityRules | null;
  conditionalVisibility?: ProductCustomFieldVisibilityRules | null;
  regexTester?: {
    sampleValue?: string | null;
    lastResult?: boolean | null;
  } | null;
} & Record<string, unknown>;

export type ProductCustomField = {
  id: string;
  label: string;
  fieldType: "text" | "url" | "number";
  placeholder?: string | null;
  helpText?: string | null;
  isRequired: boolean;
  displayOrder: number;
  metadataJson?: ProductCustomFieldMetadata | null;
  validationRules?: ProductCustomFieldValidationRules | null;
  validation?: ProductCustomFieldValidationRules | null;
  defaultValue?: string | null;
  visibilityRules?: ProductCustomFieldVisibilityRules | null;
  conditionalVisibility?: ProductCustomFieldMetadata["conditionalVisibility"];
  passthroughTargets?: NonNullable<ProductCustomFieldMetadata["passthrough"]>;
};

export type ProductSubscriptionPlan = {
  id: string;
  label: string;
  description?: string | null;
  billingCycle: "one_time" | "monthly" | "quarterly" | "annual";
  priceMultiplier?: number | null;
  priceDelta?: number | null;
  isDefault: boolean;
  displayOrder: number;
};

export type ProductDeliveryEstimate = {
  minDays?: number | null;
  maxDays?: number | null;
  averageDays?: number | null;
  confidence?: string | null;
  headline?: string | null;
  narrative?: string | null;
};

export type ProductAssurancePoint = {
  id: string;
  label: string;
  description?: string | null;
  evidence?: string | null;
  source?: string | null;
};

export type ProductSupportChannel = {
  id: string;
  channel: string;
  label: string;
  target: string;
  availability?: string | null;
};

export type ProductFulfillmentSummary = {
  delivery?: ProductDeliveryEstimate;
  assurances?: ProductAssurancePoint[];
  support?: ProductSupportChannel[];
};

export type ProductMediaAsset = {
  id: string;
  clientId?: string | null;
  assetUrl: string;
  label?: string | null;
  storageKey?: string | null;
  usageTags?: ProductAssetUsageTag[] | null;
  altText?: string | null;
  displayOrder?: number | null;
  isPrimary?: boolean | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ProductConfigurationPresetSelection = {
  optionSelections: Record<string, string[]>;
  addOnIds: string[];
  subscriptionPlanId?: string | null;
  customFieldValues: Record<string, string>;
};

export type ProductConfigurationPreset = {
  id: string;
  label: string;
  summary?: string | null;
  heroImageUrl?: string | null;
  badge?: string | null;
  priceHint?: string | null;
  displayOrder?: number | null;
  selection: ProductConfigurationPresetSelection;
};

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  basePrice: number;
  currency: string;
  status: "draft" | "active" | "archived";
  channelEligibility: string[];
  updatedAt?: string;
  optionGroups: ProductOptionGroup[];
  addOns: ProductAddOn[];
  customFields: ProductCustomField[];
  subscriptionPlans: ProductSubscriptionPlan[];
  fulfillmentSummary?: ProductFulfillmentSummary | null;
  mediaAssets?: ProductMediaAsset[];
  auditLog?: { id: string; action: string; createdAt: string }[];
  configurationPresets?: ProductConfigurationPreset[];
};
