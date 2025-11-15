export type ProviderServiceCostTier = {
  upTo?: number | null;
  unitAmount: number;
  label?: string | null;
};

export type ProviderServiceCostModel =
  | {
      kind: "flat";
      amount: number;
      currency: string;
    }
  | {
      kind: "per_unit";
      unitAmount: number;
      currency: string;
      unit?: string | null;
      minimumUnits?: number | null;
    }
  | {
      kind: "tiered";
      currency: string;
      tiers: ProviderServiceCostTier[];
      amount?: number | null;
    };

export type ProviderServiceCadence = {
  batchSize?: number | null;
  defaultDailyQuota?: number | null;
  fulfillmentWindowHours?: number | null;
  refillWindowHours?: number | null;
  expectedCompletionHours?: number | null;
  supportsRefill?: boolean;
  notes?: string | null;
};

export type ProviderServiceFieldOption = {
  label: string;
  value: string | number;
};

export type ProviderServiceConfigurationField = {
  key: string;
  label: string;
  inputType: "string" | "number" | "integer" | "boolean" | "select";
  required?: boolean;
  description?: string | null;
  options?: ProviderServiceFieldOption[];
  defaultValue?: string | number | boolean | null;
};

export type ProviderServiceConfiguration =
  | {
      schemaType: "json_schema";
      jsonSchema: Record<string, unknown>;
      fields?: ProviderServiceConfigurationField[];
    }
  | {
      schemaType?: "key_value";
      fields?: ProviderServiceConfigurationField[];
      jsonSchema?: Record<string, unknown>;
    };

export type ProviderServiceGuardrails = {
  minimumMarginPercent?: number | null;
  warningMarginPercent?: number | null;
  minimumMarginAbsolute?: number | null;
  currency?: string | null;
  notes?: string | null;
};

export type ProviderServiceDefaultInputs = {
  quantity?: number | null;
  durationDays?: number | null;
  ratePerDay?: number | null;
  geo?: string | null;
};

export type ProviderServicePayloadTemplate = {
  operation: "order" | "refill" | "balance" | "cancel";
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  successCodes?: number[];
  responseMappings?: Record<string, string>;
};

export type ProviderServiceMetadata = {
  version?: number;
  costModel?: ProviderServiceCostModel | null;
  cadence?: ProviderServiceCadence | null;
  configuration?: ProviderServiceConfiguration | null;
  guardrails?: ProviderServiceGuardrails | null;
  payloadTemplates?: ProviderServicePayloadTemplate[];
  defaultInputs?: ProviderServiceDefaultInputs | null;
  legacy?: Record<string, unknown> | null;
  [key: string]: unknown;
};
