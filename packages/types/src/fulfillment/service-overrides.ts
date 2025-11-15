export type ServiceOverrideChannelCondition = {
  kind: "channel";
  channels: string[];
};

export type ServiceOverrideGeoCondition = {
  kind: "geo";
  regions: string[];
};

export type ServiceOverrideOptionCondition = {
  kind: "option";
  optionId?: string;
  optionKey?: string;
};

export type ServiceOverrideAmountCondition = {
  kind: "amount";
  min?: number | null;
  max?: number | null;
};

export type ServiceOverrideDripCondition = {
  kind: "drip";
  min?: number | null;
  max?: number | null;
};

export type ServiceOverrideCondition =
  | ServiceOverrideChannelCondition
  | ServiceOverrideGeoCondition
  | ServiceOverrideOptionCondition
  | ServiceOverrideAmountCondition
  | ServiceOverrideDripCondition;

export type ServiceOverrideRuleOverrides = {
  serviceId?: string | null;
  providerId?: string | null;
  costAmount?: number | null;
  costCurrency?: string | null;
  marginTarget?: number | null;
  fulfillmentMode?: "immediate" | "scheduled" | "refill";
  payloadTemplate?: Record<string, unknown> | null;
  dripPerDay?: number | null;
  previewQuantity?: number | null;
};

export type ServiceOverrideRule = {
  id: string;
  label?: string | null;
  description?: string | null;
  priority?: number | null;
  conditions: ServiceOverrideCondition[];
  overrides: ServiceOverrideRuleOverrides;
};

export type FulfillmentProviderRuleMetadata = {
  id: string;
  label?: string | null;
  description?: string | null;
  priority?: number | null;
  conditions?: ServiceOverrideCondition[];
  overrides?: ServiceOverrideRuleOverrides;
};

export type FulfillmentProviderRuleMetadataMap = Record<string, FulfillmentProviderRuleMetadata>;
