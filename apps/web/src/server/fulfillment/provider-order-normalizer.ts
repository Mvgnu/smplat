import type {
  FulfillmentProviderOrder,
  FulfillmentProviderOrderRefill,
  FulfillmentProviderOrderReplayEntry,
  FulfillmentProviderRuleMetadataMap
} from "@/types/fulfillment";

export type ApiProviderOrderRefillRecord = {
  id: string;
  amount?: number | null;
  currency?: string | null;
  performedAt: string;
  response?: Record<string, unknown> | null;
};

export type ApiProviderOrderReplayRecord = {
  id: string;
  requestedAmount?: number | null;
  currency?: string | null;
  performedAt?: string | null;
  scheduledFor?: string | null;
  status: "executed" | "scheduled" | "failed";
  response?: Record<string, unknown> | null;
  ruleIds?: string[] | null;
  ruleMetadata?: Record<string, unknown> | null;
};

export type ApiProviderOrderRecord = {
  id: string;
  providerId: string;
  providerName?: string | null;
  serviceId: string;
  serviceAction?: string | null;
  orderId: string;
  orderItemId: string;
  amount?: number | null;
  currency?: string | null;
  providerOrderId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  refills?: ApiProviderOrderRefillRecord[];
  replays?: ApiProviderOrderReplayRecord[];
  scheduledReplays?: ApiProviderOrderReplayRecord[];
};

export function normalizeProviderOrder(record: ApiProviderOrderRecord): FulfillmentProviderOrder {
  return {
    id: record.id,
    providerId: record.providerId,
    providerName: record.providerName ?? null,
    serviceId: record.serviceId,
    serviceAction: record.serviceAction ?? null,
    orderId: record.orderId,
    orderItemId: record.orderItemId,
    amount: record.amount ?? null,
    currency: record.currency ?? null,
    providerOrderId: record.providerOrderId ?? null,
    payload: record.payload ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    refills: Array.isArray(record.refills) ? record.refills.map(normalizeProviderOrderRefill) : [],
    replays: Array.isArray(record.replays) ? record.replays.map(normalizeProviderOrderReplay) : [],
    scheduledReplays: Array.isArray(record.scheduledReplays)
      ? record.scheduledReplays.map(normalizeProviderOrderReplay)
      : []
  };
}

export function normalizeProviderOrderRefill(record: ApiProviderOrderRefillRecord): FulfillmentProviderOrderRefill {
  return {
    id: record.id,
    amount: record.amount ?? null,
    currency: record.currency ?? null,
    performedAt: record.performedAt,
    response: record.response ?? null
  };
}

export function normalizeProviderOrderReplay(record: ApiProviderOrderReplayRecord): FulfillmentProviderOrderReplayEntry {
  return {
    id: record.id,
    requestedAmount: record.requestedAmount ?? null,
    currency: record.currency ?? null,
    performedAt: record.performedAt ?? null,
    scheduledFor: record.scheduledFor ?? null,
    status: record.status,
    response: record.response ?? null,
    ruleIds: Array.isArray(record.ruleIds) ? (record.ruleIds as string[]) : null,
    ruleMetadata: normalizeRuleMetadataMap(record.ruleMetadata)
  };
}

function normalizeRuleMetadataMap(
  payload: Record<string, unknown> | null | undefined
): FulfillmentProviderRuleMetadataMap | null {
  if (!isRecord(payload)) {
    return null;
  }
  const normalized: FulfillmentProviderRuleMetadataMap = {};
  for (const [ruleId, raw] of Object.entries(payload)) {
    if (!isRecord(raw)) {
      continue;
    }
    const entryId = typeof raw.id === "string" && raw.id.trim().length ? raw.id.trim() : ruleId;
    const entry: FulfillmentProviderRuleMetadataMap[string] = { id: entryId };
    if (typeof raw.label === "string" && raw.label.trim().length) {
      entry.label = raw.label;
    }
    if (typeof raw.description === "string" && raw.description.trim().length) {
      entry.description = raw.description;
    }
    if (typeof raw.priority === "number" && Number.isFinite(raw.priority)) {
      entry.priority = raw.priority;
    }
    if (Array.isArray(raw.conditions)) {
      entry.conditions = raw.conditions as FulfillmentProviderRuleMetadataMap[string]["conditions"];
    }
    if (isRecord(raw.overrides)) {
      entry.overrides = raw.overrides as FulfillmentProviderRuleMetadataMap[string]["overrides"];
    }
    normalized[entryId] = entry;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
