import "server-only";

import type {
  FulfillmentProvider,
  FulfillmentProviderOrder,
  FulfillmentProviderOrderRefill,
  FulfillmentProviderOrderReplayEntry,
  FulfillmentService,
} from "@/types/fulfillment";
import {
  normalizeProviderOrder,
  normalizeProviderOrderRefill,
  normalizeProviderOrderReplay,
  type ApiProviderOrderRecord,
  type ApiProviderOrderRefillRecord,
  type ApiProviderOrderReplayRecord,
} from "./provider-order-normalizer";
import type {
  ProviderServiceMetadata,
  ProviderServiceCostModel,
  ProviderServiceCadence,
  ProviderServiceConfiguration,
  ProviderServiceGuardrails,
  ProviderServicePayloadTemplate,
  ProviderServiceCostTier,
  ProviderServiceConfigurationField,
  ProviderServiceFieldOption,
  ProviderServiceDefaultInputs,
} from "@smplat/types";

export const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
export const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

type ApiProviderRecord = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string | null;
  status: FulfillmentProvider["status"];
  healthStatus: FulfillmentProvider["healthStatus"];
  allowedRegions?: string[] | null;
  rateLimitPerMinute: number | null;
  metadata?: Record<string, unknown> | null;
  credentials?: Record<string, unknown> | null;
  lastHealthCheckAt: string | null;
  healthPayload?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  services: ApiServiceRecord[];
  balanceSnapshot?: {
    amount?: number | null;
    currency?: string | null;
    retrievedAt?: string | null;
    payload?: Record<string, unknown> | null;
  } | null;
};

type ApiServiceRecord = {
  id: string;
  providerId: string;
  name: string;
  action: string;
  category: string | null;
  defaultCurrency: string | null;
  status: FulfillmentService["status"];
  healthStatus: FulfillmentService["healthStatus"];
  allowedRegions?: string[] | null;
  rateLimitPerMinute: number | null;
  metadata?: Record<string, unknown> | null;
  credentials?: Record<string, unknown> | null;
  lastHealthCheckAt: string | null;
  healthPayload?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};


function normalizeProvider(record: ApiProviderRecord): FulfillmentProvider {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    baseUrl: record.baseUrl ?? null,
    status: record.status,
    healthStatus: record.healthStatus,
    allowedRegions: Array.isArray(record.allowedRegions) ? record.allowedRegions : [],
    rateLimitPerMinute: record.rateLimitPerMinute ?? null,
    metadata: record.metadata ?? {},
    credentials: record.credentials ?? null,
    lastHealthCheckAt: record.lastHealthCheckAt,
    healthPayload: record.healthPayload ?? {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    balanceSnapshot: record.balanceSnapshot
      ? {
          amount: record.balanceSnapshot.amount ?? null,
          currency: record.balanceSnapshot.currency ?? null,
          retrievedAt: record.balanceSnapshot.retrievedAt ?? null,
          payload: record.balanceSnapshot.payload ?? null,
        }
      : null,
    services: (record.services ?? []).map(normalizeService),
  };
}

function normalizeService(record: ApiServiceRecord): FulfillmentService {
  return {
    id: record.id,
    providerId: record.providerId,
    name: record.name,
    action: record.action,
    category: record.category ?? null,
    defaultCurrency: record.defaultCurrency ?? null,
    status: record.status,
    healthStatus: record.healthStatus,
    allowedRegions: Array.isArray(record.allowedRegions) ? record.allowedRegions : [],
    rateLimitPerMinute: record.rateLimitPerMinute ?? null,
    metadata: normalizeServiceMetadata(record.metadata, {
      defaultCurrency: record.defaultCurrency ?? undefined,
    }),
    credentials: record.credentials ?? null,
    lastHealthCheckAt: record.lastHealthCheckAt,
    healthPayload: record.healthPayload ?? {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeServiceMetadata(
  payload: Record<string, unknown> | null | undefined,
  { defaultCurrency }: { defaultCurrency?: string },
): ProviderServiceMetadata {
  const record = isRecord(payload) ? payload : {};
  const metadata: ProviderServiceMetadata = {
    version: numberOrUndefined(record.version) ?? 1,
    costModel: normalizeCostModel(record.costModel, defaultCurrency),
    cadence: normalizeCadence(record.cadence),
    configuration: normalizeConfiguration(record.configuration),
    guardrails: normalizeGuardrails(record.guardrails, defaultCurrency),
    payloadTemplates: normalizePayloadTemplates(record.payloadTemplates),
    defaultInputs: normalizeDefaultInputs(record.defaultInputs),
  };
  if (isRecord(record.legacy) && Object.keys(record.legacy).length) {
    metadata.legacy = record.legacy;
  }
  return metadata;
}

function normalizeCostModel(
  payload: unknown,
  fallbackCurrency?: string,
): ProviderServiceCostModel | undefined {
  if (!isRecord(payload) || typeof payload.kind !== "string") {
    return undefined;
  }
  const currency =
    typeof payload.currency === "string" && payload.currency.length >= 3
      ? payload.currency
      : fallbackCurrency;
  if (!currency) {
    return undefined;
  }
  if (payload.kind === "flat") {
    const amount = numberOrUndefined(payload.amount) ?? numberOrUndefined(payload.unitAmount);
    if (amount == null) {
      return undefined;
    }
    return { kind: "flat", amount, currency };
  }
  if (payload.kind === "per_unit") {
    const unitAmount = numberOrUndefined(payload.unitAmount) ?? numberOrUndefined(payload.amount);
    if (unitAmount == null) {
      return undefined;
    }
    const next: Extract<ProviderServiceCostModel, { kind: "per_unit" }> = {
      kind: "per_unit",
      unitAmount,
      currency,
    };
    if (stringOrUndefined(payload.unit)) {
      next.unit = payload.unit as string;
    }
    if (numberOrUndefined(payload.minimumUnits)) {
      next.minimumUnits = numberOrUndefined(payload.minimumUnits);
    }
    return next;
  }
  if (payload.kind === "tiered") {
    const tiers = Array.isArray(payload.tiers)
      ? payload.tiers
          .map((entry) => {
            if (!isRecord(entry)) {
              return undefined;
            }
            const unitAmount = numberOrUndefined(entry.unitAmount);
            if (unitAmount == null) {
              return undefined;
            }
            const tier: ProviderServiceCostTier = { unitAmount };
            if (numberOrUndefined(entry.upTo)) {
              tier.upTo = numberOrUndefined(entry.upTo);
            }
            if (stringOrUndefined(entry.label)) {
              tier.label = entry.label as string;
            }
            return tier;
          })
          .filter(Boolean) as ProviderServiceCostTier[]
      : [];
    if (!tiers.length) {
      return undefined;
    }
    const next: Extract<ProviderServiceCostModel, { kind: "tiered" }> = {
      kind: "tiered",
      currency,
      tiers,
    };
    if (numberOrUndefined(payload.amount)) {
      next.amount = numberOrUndefined(payload.amount);
    }
    return next;
  }
  return undefined;
}

function normalizeCadence(payload: unknown): ProviderServiceCadence | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const cadence: ProviderServiceCadence = {};
  if (numberOrUndefined(payload.batchSize)) {
    cadence.batchSize = numberOrUndefined(payload.batchSize);
  }
  if (numberOrUndefined(payload.defaultDailyQuota)) {
    cadence.defaultDailyQuota = numberOrUndefined(payload.defaultDailyQuota);
  }
  if (numberOrUndefined(payload.fulfillmentWindowHours)) {
    cadence.fulfillmentWindowHours = numberOrUndefined(payload.fulfillmentWindowHours);
  }
  if (numberOrUndefined(payload.refillWindowHours)) {
    cadence.refillWindowHours = numberOrUndefined(payload.refillWindowHours);
  }
  if (numberOrUndefined(payload.expectedCompletionHours)) {
    cadence.expectedCompletionHours = numberOrUndefined(payload.expectedCompletionHours);
  }
  if (typeof payload.supportsRefill === "boolean") {
    cadence.supportsRefill = payload.supportsRefill;
  }
  if (stringOrUndefined(payload.notes)) {
    cadence.notes = payload.notes as string;
  }
  return Object.keys(cadence).length ? cadence : undefined;
}

function normalizeConfiguration(payload: unknown): ProviderServiceConfiguration | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const schemaType = payload.schemaType === "json_schema" ? "json_schema" : "key_value";
  const fields = Array.isArray(payload.fields)
    ? payload.fields
        .map((field) => {
          if (!isRecord(field) || typeof field.key !== "string" || typeof field.label !== "string") {
            return undefined;
          }
          const normalized: ProviderServiceConfigurationField = {
            key: field.key,
            label: field.label,
            inputType:
              field.inputType === "select" ||
              field.inputType === "integer" ||
              field.inputType === "number" ||
              field.inputType === "boolean"
                ? field.inputType
                : "string",
            required: typeof field.required === "boolean" ? field.required : undefined,
            description: stringOrUndefined(field.description),
            defaultValue: field.defaultValue as ProviderServiceConfigurationField["defaultValue"],
          };
          if (Array.isArray(field.options)) {
            normalized.options = field.options
              .map((option) => {
                if (!isRecord(option) || typeof option.label !== "string") {
                  return undefined;
                }
                if (
                  typeof option.value !== "string" &&
                  typeof option.value !== "number"
                ) {
                  return undefined;
                }
                return {
                  label: option.label,
                  value: option.value as string | number,
                };
              })
              .filter(Boolean) as ProviderServiceFieldOption[];
          }
          return normalized;
        })
        .filter(Boolean) as ProviderServiceConfigurationField[]
    : undefined;
  if (schemaType === "json_schema") {
    const jsonSchema = isRecord(payload.jsonSchema) ? (payload.jsonSchema as Record<string, unknown>) : {};
    return { schemaType, jsonSchema, fields };
  }
  return { schemaType, fields };
}

function normalizeGuardrails(
  payload: unknown,
  fallbackCurrency?: string,
): ProviderServiceGuardrails | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const guardrails: ProviderServiceGuardrails = {};
  if (numberOrUndefined(payload.minimumMarginPercent) != null) {
    guardrails.minimumMarginPercent = numberOrUndefined(payload.minimumMarginPercent);
  }
  if (numberOrUndefined(payload.warningMarginPercent) != null) {
    guardrails.warningMarginPercent = numberOrUndefined(payload.warningMarginPercent);
  }
  if (numberOrUndefined(payload.minimumMarginAbsolute) != null) {
    guardrails.minimumMarginAbsolute = numberOrUndefined(payload.minimumMarginAbsolute);
  }
  const currency =
    typeof payload.currency === "string" && payload.currency.length >= 3
      ? payload.currency
      : fallbackCurrency;
  if (currency) {
    guardrails.currency = currency;
  }
  if (stringOrUndefined(payload.notes)) {
    guardrails.notes = payload.notes as string;
  }
  return Object.keys(guardrails).length ? guardrails : undefined;
}

function normalizePayloadTemplates(payload: unknown): ProviderServicePayloadTemplate[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.operation !== "string" || typeof entry.path !== "string") {
        return undefined;
      }
      const normalized: ProviderServicePayloadTemplate = {
        operation: entry.operation as ProviderServicePayloadTemplate["operation"],
        method:
          entry.method === "GET" ||
          entry.method === "PUT" ||
          entry.method === "PATCH" ||
          entry.method === "DELETE"
            ? entry.method
            : "POST",
        path: entry.path,
      };
      if (isRecord(entry.headers)) {
        normalized.headers = Object.fromEntries(
          Object.entries(entry.headers).filter(([, value]) => typeof value === "string"),
        ) as Record<string, string>;
      }
      if (isRecord(entry.bodyTemplate)) {
        normalized.bodyTemplate = entry.bodyTemplate as Record<string, unknown>;
      }
      if (Array.isArray(entry.successCodes)) {
        const codes = entry.successCodes.filter((code) => typeof code === "number") as number[];
        if (codes.length) {
          normalized.successCodes = codes;
        }
      }
      if (isRecord(entry.responseMappings)) {
        normalized.responseMappings = Object.fromEntries(
          Object.entries(entry.responseMappings).filter(([, value]) => typeof value === "string"),
        ) as Record<string, string>;
      }
      return normalized;
    })
    .filter(Boolean) as ProviderServicePayloadTemplate[];
}

function normalizeDefaultInputs(payload: unknown): ProviderServiceMetadata["defaultInputs"] | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const defaults: ProviderServiceDefaultInputs = {};
  if (numberOrUndefined(payload.quantity) != null) {
    defaults.quantity = numberOrUndefined(payload.quantity);
  }
  if (numberOrUndefined(payload.durationDays) != null) {
    defaults.durationDays = numberOrUndefined(payload.durationDays);
  }
  if (numberOrUndefined(payload.ratePerDay) != null) {
    defaults.ratePerDay = numberOrUndefined(payload.ratePerDay);
  }
  if (stringOrUndefined(payload.geo)) {
    defaults.geo = payload.geo as string;
  }
  return Object.keys(defaults).length ? defaults : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function extractError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // ignore
  }
  return `Request failed with status ${response.status}`;
}

export async function fetchFulfillmentProviders(): Promise<FulfillmentProvider[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers`, {
    method: "GET",
    headers: defaultHeaders,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const payload = (await response.json()) as ApiProviderRecord[];
  return payload.map(normalizeProvider);
}

export async function createFulfillmentProvider(
  input: Record<string, unknown>,
): Promise<FulfillmentProvider> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiProviderRecord;
  return normalizeProvider(record);
}

export async function updateFulfillmentProvider(
  providerId: string,
  input: Record<string, unknown>,
): Promise<FulfillmentProvider> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}`, {
    method: "PATCH",
    headers: defaultHeaders,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiProviderRecord;
  return normalizeProvider(record);
}

export async function deleteFulfillmentProvider(providerId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}`, {
    method: "DELETE",
    headers: defaultHeaders,
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
}

export async function createFulfillmentService(
  providerId: string,
  input: Record<string, unknown>,
): Promise<FulfillmentService> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/services`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiServiceRecord;
  return normalizeService(record);
}

export async function updateFulfillmentService(
  providerId: string,
  serviceId: string,
  input: Record<string, unknown>,
): Promise<FulfillmentService> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/services/${serviceId}`,
    {
      method: "PATCH",
      headers: defaultHeaders,
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiServiceRecord;
  return normalizeService(record);
}

export async function deleteFulfillmentService(providerId: string, serviceId: string): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/services/${serviceId}`,
    {
      method: "DELETE",
      headers: defaultHeaders,
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
}

export async function refreshProviderBalance(providerId: string): Promise<FulfillmentProvider> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/balance/refresh`,
    {
      method: "POST",
      headers: defaultHeaders,
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiProviderRecord;
  return normalizeProvider(record);
}

export async function fetchProviderOrders(
  providerId: string,
  limit = 25,
): Promise<FulfillmentProviderOrder[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/orders?limit=${encodeURIComponent(
      String(limit),
    )}`,
    {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const payload = (await response.json()) as ApiProviderOrderRecord[];
  return payload.map(normalizeProviderOrder);
}

export async function fetchProviderOrdersForOrder(orderId: string, limit = 100): Promise<FulfillmentProviderOrder[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/orders/by-order/${orderId}?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const payload = (await response.json()) as ApiProviderOrderRecord[];
  return payload.map(normalizeProviderOrder);
}

export async function triggerProviderOrderRefill(
  providerId: string,
  providerOrderId: string,
  input: { amount?: number | null; note?: string },
): Promise<FulfillmentProviderOrderRefill> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/orders/${providerOrderId}/refill`,
    {
      method: "POST",
      headers: defaultHeaders,
      body: JSON.stringify(input ?? {}),
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiProviderOrderRefillRecord;
  return normalizeProviderOrderRefill(record);
}

export async function triggerProviderOrderReplay(
  providerId: string,
  providerOrderId: string,
  input: { amount?: number | null; runAt?: string; scheduleOnly?: boolean },
): Promise<FulfillmentProviderOrderReplayEntry> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/${providerId}/orders/${providerOrderId}/replay`,
    {
      method: "POST",
      headers: defaultHeaders,
      body: JSON.stringify(input ?? {}),
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const record = (await response.json()) as ApiProviderOrderReplayRecord;
  return normalizeProviderOrderReplay(record);
}
