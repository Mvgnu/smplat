export type ProductOption = {
  id: string;
  label: string;
  description?: string | null;
  priceDelta: number;
  metadataJson?: Record<string, unknown> | null;
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
};

export type ProductCustomField = {
  id: string;
  label: string;
  fieldType: "text" | "url" | "number";
  placeholder?: string | null;
  helpText?: string | null;
  isRequired: boolean;
  displayOrder: number;
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
  mediaAssets?: { id: string; assetUrl: string; label?: string | null }[];
  auditLog?: { id: string; action: string; createdAt: string }[];
};
