import "server-only";

import { readFile } from "node:fs/promises";

import type {
  CartAddOnSelection,
  CartOptionCalculatorPreview,
  CartOptionSelection,
  CartSelectionSnapshot,
  CartSubscriptionSelection,
} from "@/types/cart";
import type { ProductOptionStructuredPricing } from "@/types/product";
import type { FulfillmentProviderOrder } from "@/types/fulfillment";
import {
  normalizeProviderOrder,
  type ApiProviderOrderRecord,
  type ApiProviderOrderRefillRecord,
  type ApiProviderOrderReplayRecord
} from "@/server/fulfillment/provider-order-normalizer";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";
const mockAdminOrdersPath = process.env.MOCK_ADMIN_ORDER_HISTORY_PATH ?? null;
let mockAdminOrdersCache: AdminOrder[] | null | undefined;

export type OrderItemPlatformContext = {
  id: string;
  label: string;
  handle: string | null;
  platformType: string | null;
};

export type AdminOrderItem = {
  id: string;
  productId: string | null;
  productTitle: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions: CartSelectionSnapshot | null;
  attributes: Record<string, unknown> | null;
  platformContext: OrderItemPlatformContext | null;
  customerSocialAccountId: string | null;
  baselineMetrics: Record<string, unknown> | null;
  deliverySnapshots: Record<string, unknown> | null;
  targetMetrics: Record<string, unknown> | null;
};

export type AdminOrder = {
  id: string;
  orderNumber: string;
  userId: string | null;
  status: string;
  source: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
  providerOrders: FulfillmentProviderOrder[];
  loyaltyProjectionPoints: number | null;
  receiptStorageKey: string | null;
  receiptStorageUrl: string | null;
  receiptStorageUploadedAt: string | null;
};

export type OrderItemPayload = {
  id: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  selected_options: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  platform_context?: Record<string, unknown> | null;
  platformContext?: Record<string, unknown> | null;
  customer_social_account_id?: string | null;
  baseline_metrics?: Record<string, unknown> | null;
  delivery_snapshots?: Record<string, unknown> | null;
  target_metrics?: Record<string, unknown> | null;
};

export type OrderPayload = {
  id: string;
  order_number: string;
  user_id: string | null;
  status: string;
  source: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItemPayload[];
  providerOrders?: unknown;
  provider_orders?: unknown;
  loyalty_projection_points?: number | null;
  receipt_storage_key?: string | null;
  receipt_storage_url?: string | null;
  receipt_storage_uploaded_at?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) ? Number(numeric) : fallback;
};

const parseCalculatorPreview = (raw: unknown): CartOptionCalculatorPreview | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const expression = typeof raw.expression === "string" ? raw.expression : null;
  if (!expression) {
    return null;
  }
  const preview: CartOptionCalculatorPreview = {
    expression,
  };
  if (raw.sampleAmount != null) {
    const amount = toFiniteNumber(raw.sampleAmount, NaN);
    if (Number.isFinite(amount)) {
      preview.sampleAmount = amount;
    }
  }
  if (raw.sampleDays != null) {
    const days = toFiniteNumber(raw.sampleDays, NaN);
    if (Number.isFinite(days)) {
      preview.sampleDays = days;
    }
  }
  if (raw.sampleResult != null) {
    const result = toFiniteNumber(raw.sampleResult, NaN);
    if (Number.isFinite(result)) {
      preview.sampleResult = result;
    }
  }
  return preview;
};

const parseOptionSelection = (raw: unknown): CartOptionSelection | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const groupId = typeof raw.groupId === "string" ? raw.groupId : null;
  const optionId = typeof raw.optionId === "string" ? raw.optionId : null;
  const label = typeof raw.label === "string" ? raw.label : null;
  if (!groupId || !optionId || label == null) {
    return null;
  }
  const selection: CartOptionSelection = {
    groupId,
    groupName: typeof raw.groupName === "string" ? raw.groupName : groupId,
    optionId,
    label,
    priceDelta: toFiniteNumber(raw.priceDelta, 0),
    structuredPricing: (raw.structuredPricing ?? null) as ProductOptionStructuredPricing | null,
    marketingTagline: typeof raw.marketingTagline === "string" ? raw.marketingTagline : null,
    fulfillmentSla: typeof raw.fulfillmentSla === "string" ? raw.fulfillmentSla : null,
    heroImageUrl: typeof raw.heroImageUrl === "string" ? raw.heroImageUrl : null,
  };
  const calculator = parseCalculatorPreview(raw.calculator);
  if (calculator) {
    selection.calculator = calculator;
  }
  return selection;
};

const parseAddOnSelection = (raw: unknown): CartAddOnSelection | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : null;
  const label = typeof raw.label === "string" ? raw.label : null;
  if (!id || label == null) {
    return null;
  }
  return {
    id,
    label,
    priceDelta: toFiniteNumber(raw.priceDelta, 0),
    pricingMode:
      raw.pricingMode === "flat" || raw.pricingMode === "percentage" || raw.pricingMode === "serviceOverride"
        ? raw.pricingMode
        : undefined,
    pricingAmount: raw.pricingAmount != null ? toFiniteNumber(raw.pricingAmount, 0) : undefined,
    serviceId: typeof raw.serviceId === "string" ? raw.serviceId : undefined,
    serviceProviderId: typeof raw.serviceProviderId === "string" ? raw.serviceProviderId : undefined,
    serviceProviderName: typeof raw.serviceProviderName === "string" ? raw.serviceProviderName : undefined,
    serviceAction: typeof raw.serviceAction === "string" ? raw.serviceAction : undefined,
    serviceDescriptor: isRecord(raw.serviceDescriptor) ? raw.serviceDescriptor : null,
    providerCostAmount: raw.providerCostAmount != null ? toFiniteNumber(raw.providerCostAmount, NaN) : undefined,
    providerCostCurrency: typeof raw.providerCostCurrency === "string" ? raw.providerCostCurrency : undefined,
    marginTarget: raw.marginTarget != null ? toFiniteNumber(raw.marginTarget, NaN) : undefined,
    fulfillmentMode:
      raw.fulfillmentMode === "immediate" || raw.fulfillmentMode === "scheduled" || raw.fulfillmentMode === "refill"
        ? raw.fulfillmentMode
        : undefined,
    payloadTemplate: isRecord(raw.payloadTemplate) ? raw.payloadTemplate : null,
    dripPerDay: raw.dripPerDay != null ? toFiniteNumber(raw.dripPerDay, NaN) : undefined,
    previewQuantity: raw.previewQuantity != null ? toFiniteNumber(raw.previewQuantity, NaN) : undefined,
    serviceRules:
      raw.serviceRules === null
        ? null
        : Array.isArray(raw.serviceRules)
          ? (raw.serviceRules as CartAddOnSelection["serviceRules"])
          : undefined,
  };
};

const parsePlatformContext = (raw: unknown): OrderItemPlatformContext | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : null;
  const label = typeof raw.label === "string" ? raw.label : null;
  if (!id || !label) {
    return null;
  }
  const handle = typeof raw.handle === "string" ? raw.handle : null;
  const platformType =
    typeof raw.platformType === "string"
      ? raw.platformType
      : typeof raw.platform_type === "string"
        ? raw.platform_type
        : null;
  return {
    id,
    label,
    handle,
    platformType,
  };
};

const parseSubscriptionSelection = (raw: unknown): CartSubscriptionSelection | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : null;
  const label = typeof raw.label === "string" ? raw.label : null;
  if (!id || label == null) {
    return null;
  }
  const selection: CartSubscriptionSelection = {
    id,
    label,
    billingCycle: typeof raw.billingCycle === "string" ? raw.billingCycle : "one_time",
  };
  if (raw.priceMultiplier != null) {
    const multiplier = toFiniteNumber(raw.priceMultiplier, NaN);
    if (Number.isFinite(multiplier)) {
      selection.priceMultiplier = multiplier;
    }
  }
  if (raw.priceDelta != null) {
    const delta = toFiniteNumber(raw.priceDelta, NaN);
    if (Number.isFinite(delta)) {
      selection.priceDelta = delta;
    }
  }
  return selection;
};

const parseSelectedOptionsPayload = (raw: unknown): CartSelectionSnapshot | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const snapshot: CartSelectionSnapshot = {};

  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map((entry) => parseOptionSelection(entry))
      .filter(Boolean) as CartOptionSelection[];
    if (options.length > 0) {
      snapshot.options = options;
    }
  }

  if (Array.isArray(raw.addOns)) {
    const addOns = raw.addOns
      .map((entry) => parseAddOnSelection(entry))
      .filter(Boolean) as CartAddOnSelection[];
    if (addOns.length > 0) {
      snapshot.addOns = addOns;
    }
  }

  const plan = parseSubscriptionSelection(raw.subscriptionPlan);
  if (plan) {
    snapshot.subscriptionPlan = plan;
  }

  return Object.keys(snapshot).length > 0 ? snapshot : null;
};

const coerceRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

export const mapOrderPayload = (payload: OrderPayload): AdminOrder => ({
  id: payload.id,
  orderNumber: payload.order_number,
  userId: payload.user_id,
  status: payload.status,
  source: payload.source,
  subtotal: Number(payload.subtotal ?? 0),
  tax: Number(payload.tax ?? 0),
  total: Number(payload.total ?? 0),
  currency: payload.currency,
  notes: payload.notes,
  createdAt: payload.created_at,
  updatedAt: payload.updated_at,
  loyaltyProjectionPoints:
    typeof payload.loyalty_projection_points === "number" ? payload.loyalty_projection_points : null,
  items: Array.isArray(payload.items)
    ? payload.items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productTitle: item.product_title,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
        totalPrice: Number(item.total_price ?? 0),
        selectedOptions: parseSelectedOptionsPayload(item.selected_options),
        attributes: item.attributes ?? null,
        platformContext: parsePlatformContext(item.platform_context ?? item.platformContext ?? null),
        customerSocialAccountId: item.customer_social_account_id ?? null,
        baselineMetrics: coerceRecord(item.baseline_metrics),
        deliverySnapshots: coerceRecord(item.delivery_snapshots),
        targetMetrics: coerceRecord(item.target_metrics),
      }))
    : [],
  providerOrders: parseProviderOrdersPayload(payload.providerOrders ?? payload.provider_orders ?? null),
  receiptStorageKey:
    typeof payload.receipt_storage_key === "string" && payload.receipt_storage_key.trim().length > 0
      ? payload.receipt_storage_key.trim()
      : null,
  receiptStorageUrl:
    typeof payload.receipt_storage_url === "string" && payload.receipt_storage_url.trim().length > 0
      ? payload.receipt_storage_url.trim()
      : null,
  receiptStorageUploadedAt:
    typeof payload.receipt_storage_uploaded_at === "string" ? payload.receipt_storage_uploaded_at : null,
});

const parseProviderOrdersPayload = (raw: unknown): FulfillmentProviderOrder[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(coerceProviderOrderRecord)
    .filter((record): record is ApiProviderOrderRecord => record != null)
    .map((record) => normalizeProviderOrder(record));
};

const selectArrayField = (record: Record<string, unknown> | null, keys: string[]): unknown[] | null => {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
};

const coerceProviderOrderRecord = (raw: unknown): ApiProviderOrderRecord | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const hasCamelCase =
    typeof raw.id === "string" &&
    typeof raw.providerId === "string" &&
    typeof raw.serviceId === "string" &&
    typeof raw.orderId === "string" &&
    typeof raw.orderItemId === "string" &&
    typeof raw.createdAt === "string" &&
    typeof raw.updatedAt === "string";

  const payload = isRecord(raw.payload) ? raw.payload : null;
  const fallbackRefills = selectArrayField(payload, ["refills"]);
  const fallbackReplays = selectArrayField(payload, ["replays"]);
  const fallbackScheduled = selectArrayField(payload, ["scheduledReplays", "scheduled_replays"]);

  if (hasCamelCase) {
    return {
      id: raw.id as string,
      providerId: raw.providerId as string,
      providerName: typeof raw.providerName === "string" ? raw.providerName : null,
      serviceId: raw.serviceId as string,
      serviceAction: typeof raw.serviceAction === "string" ? raw.serviceAction : null,
      orderId: raw.orderId as string,
      orderItemId: raw.orderItemId as string,
      amount: toNullableNumber(raw.amount),
      currency: typeof raw.currency === "string" ? raw.currency : null,
      providerOrderId: typeof raw.providerOrderId === "string" ? raw.providerOrderId : null,
      payload,
      createdAt: raw.createdAt as string,
      updatedAt: raw.updatedAt as string,
      refills: parseLegacyProviderOrderRefills(raw.refills ?? fallbackRefills),
      replays: parseLegacyProviderOrderReplays(raw.replays ?? fallbackReplays),
      scheduledReplays: parseLegacyProviderOrderReplays(raw.scheduledReplays ?? fallbackScheduled)
    };
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  const providerId = typeof raw.provider_id === "string" ? raw.provider_id : null;
  const serviceId = typeof raw.service_id === "string" ? raw.service_id : null;
  const orderId = typeof raw.order_id === "string" ? raw.order_id : null;
  const orderItemId = typeof raw.order_item_id === "string" ? raw.order_item_id : null;
  const createdAt = typeof raw.created_at === "string" ? raw.created_at : null;
  const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : null;

  if (!id || !providerId || !serviceId || !orderId || !orderItemId || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    providerId,
    providerName: typeof raw.provider_name === "string" ? raw.provider_name : null,
    serviceId,
    serviceAction: typeof raw.service_action === "string" ? raw.service_action : null,
    orderId,
    orderItemId,
    amount: toNullableNumber(raw.amount),
    currency: typeof raw.currency === "string" ? raw.currency : null,
    providerOrderId: typeof raw.provider_order_id === "string" ? raw.provider_order_id : null,
    payload,
    createdAt,
    updatedAt,
    refills: parseLegacyProviderOrderRefills(raw.refills ?? fallbackRefills),
    replays: parseLegacyProviderOrderReplays(raw.replays ?? fallbackReplays),
    scheduledReplays: parseLegacyProviderOrderReplays(
      (raw.scheduled_replays ?? raw.scheduledReplays) ?? fallbackScheduled
    )
  };
};

const parseLegacyProviderOrderRefills = (raw: unknown): ApiProviderOrderRefillRecord[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const id = typeof entry.id === "string" ? entry.id : null;
      const performedAt =
        typeof entry.performed_at === "string"
          ? entry.performed_at
          : typeof entry.performedAt === "string"
            ? entry.performedAt
            : null;
      if (!id || !performedAt) {
        return null;
      }
      return {
        id,
        amount: toNullableNumber(entry.amount),
        currency: typeof entry.currency === "string" ? entry.currency : null,
        performedAt,
        response: isRecord(entry.response) ? entry.response : null
      };
    })
    .filter((entry): entry is ApiProviderOrderRefillRecord => entry != null);
};

const parseLegacyProviderOrderReplays = (raw: unknown): ApiProviderOrderReplayRecord[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.status !== "string") {
        return null;
      }
      const id = typeof entry.id === "string" ? entry.id : null;
      if (!id) {
        return null;
      }
      const performedAt =
        typeof entry.performed_at === "string"
          ? entry.performed_at
          : typeof entry.performedAt === "string"
            ? entry.performedAt
            : null;
      const scheduledFor =
        typeof entry.scheduled_for === "string"
          ? entry.scheduled_for
          : typeof entry.scheduledFor === "string"
            ? entry.scheduledFor
            : null;
      return {
        id,
        requestedAmount: toNullableNumber(entry.requested_amount ?? entry.requestedAmount),
        currency: typeof entry.currency === "string" ? entry.currency : null,
        performedAt,
        scheduledFor,
        status:
          entry.status === "executed" || entry.status === "scheduled" || entry.status === "failed"
            ? entry.status
            : "failed",
        response: isRecord(entry.response) ? entry.response : null,
        ruleIds: Array.isArray(entry.rule_ids)
          ? (entry.rule_ids as string[])
          : Array.isArray(entry.ruleIds)
            ? (entry.ruleIds as string[])
            : null,
        ruleMetadata: isRecord(entry.rule_metadata)
          ? (entry.rule_metadata as Record<string, unknown>)
          : isRecord(entry.ruleMetadata)
            ? (entry.ruleMetadata as Record<string, unknown>)
            : null
      };
    })
    .filter((entry): entry is ApiProviderOrderReplayRecord => entry != null);
};

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const defaultHeaders: HeadersInit = checkoutApiKey
  ? {
      "X-API-Key": checkoutApiKey
    }
  : {};

export async function fetchAdminOrders(limit = 50): Promise<AdminOrder[]> {
  const mockOrders = await loadMockAdminOrders();
  if (mockOrders) {
    return mockOrders.slice(0, limit);
  }
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders?limit=${limit}`, {
      headers: defaultHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      console.warn("Failed to fetch admin orders", response.status);
      return [];
    }

    const payload = (await response.json()) as OrderPayload[];
    return payload.map(mapOrderPayload);
  } catch (error) {
    console.warn("Unexpected error fetching admin orders", error);
    return [];
  }
}

export async function fetchAdminOrder(orderId: string): Promise<AdminOrder | null> {
  if (!orderId) {
    return null;
  }

  const mockOrders = await loadMockAdminOrders();
  if (mockOrders) {
    return mockOrders.find((order) => order.id === orderId) ?? null;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}`, {
      headers: defaultHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn("Failed to fetch admin order", orderId, response.status);
      }
      return null;
    }

    const payload = (await response.json()) as OrderPayload;
    return mapOrderPayload(payload);
  } catch (error) {
    console.warn("Unexpected error fetching admin order", orderId, error);
    return null;
  }
}

export async function updateAdminOrderStatus(orderId: string, status: string, options: { notes?: string } = {}): Promise<boolean> {
  if (!orderId || !status) {
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      status,
      actorType: "operator",
      actorLabel: "Admin console",
    };
    if (options.notes && options.notes.trim().length > 0) {
      payload.notes = options.notes.trim();
    }
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...defaultHeaders
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn("Failed to update admin order status", orderId, status, response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Unexpected error updating admin order status", orderId, error);
    return false;
  }
}

async function loadMockAdminOrders(): Promise<AdminOrder[] | null> {
  if (!mockAdminOrdersPath) {
    return null;
  }
  if (mockAdminOrdersCache !== undefined) {
    return mockAdminOrdersCache;
  }
  try {
    const file = await readFile(mockAdminOrdersPath, "utf-8");
    const payload = JSON.parse(file) as OrderPayload[];
    mockAdminOrdersCache = Array.isArray(payload) ? payload.map(mapOrderPayload) : [];
  } catch (error) {
    console.warn("Failed to read mock admin orders", error);
    mockAdminOrdersCache = [];
  }
  return mockAdminOrdersCache;
}
