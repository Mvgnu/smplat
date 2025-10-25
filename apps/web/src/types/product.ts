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

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  basePrice: number;
  currency: string;
  status: "draft" | "active" | "archived";
  optionGroups: ProductOptionGroup[];
  addOns: ProductAddOn[];
  customFields: ProductCustomField[];
  subscriptionPlans: ProductSubscriptionPlan[];
};
