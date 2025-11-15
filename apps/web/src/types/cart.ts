import type {
  ProductAssurancePoint,
  ProductDeliveryEstimate,
  ProductOptionStructuredPricing,
  ProductSupportChannel,
  ServiceOverrideRule,
} from "@/types/product";

export type CartOptionCalculatorPreview = {
  expression: string;
  sampleAmount?: number | null;
  sampleDays?: number | null;
  sampleResult?: number | null;
};

export type CartOptionSelection = {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  priceDelta: number;
  structuredPricing?: ProductOptionStructuredPricing | null;
  marketingTagline?: string | null;
  fulfillmentSla?: string | null;
  heroImageUrl?: string | null;
  calculator?: CartOptionCalculatorPreview | null;
};

export type CartAddOnSelection = {
  id: string;
  label: string;
  priceDelta: number;
  pricingMode?: "flat" | "percentage" | "serviceOverride";
  pricingAmount?: number | null;
  serviceId?: string | null;
  serviceProviderId?: string | null;
  serviceProviderName?: string | null;
  serviceAction?: string | null;
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

export type CartCustomFieldValue = {
  id: string;
  label: string;
  value: string;
};

export type CartSubscriptionSelection = {
  id: string;
  label: string;
  billingCycle: string;
  priceMultiplier?: number | null;
  priceDelta?: number | null;
};

export type CartProductExperience = {
  slug: string;
  name: string;
  category: string;
  journeyInsight: string;
  trustSignal: {
    value: string;
    label: string;
  };
  loyaltyHint: {
    value: string;
    reward: string;
    progress: number;
    pointsEstimate?: number;
  };
  highlights: Array<{
    id: string;
    label: string;
  }>;
  sla: string;
};

export type CartItem = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  currency: string;
  basePrice: number;
  quantity: number;
  unitPrice: number;
  selectedOptions: CartOptionSelection[];
  addOns: CartAddOnSelection[];
  subscriptionPlan?: CartSubscriptionSelection;
  customFields: CartCustomFieldValue[];
  deliveryEstimate?: ProductDeliveryEstimate | null;
  assuranceHighlights?: ProductAssurancePoint[];
  supportChannels?: ProductSupportChannel[];
  presetId?: string | null;
  presetLabel?: string | null;
  experience?: CartProductExperience;
};

export type CartSelectionSnapshot = {
  options?: CartOptionSelection[];
  addOns?: CartAddOnSelection[];
  subscriptionPlan?: CartSubscriptionSelection | null;
  presetId?: string | null;
  presetLabel?: string | null;
};
