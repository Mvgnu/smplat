import { Buffer } from "node:buffer";

import type { AdminOrder } from "@/server/orders/admin-orders";
import type { DeliveryProofAggregateResponse, OrderDeliveryProof } from "@/types/delivery-proof";
import {
  summarizeProviderAutomationTelemetry,
  type ProviderAutomationTelemetry,
} from "@/lib/provider-service-insights";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type OrderPricingExperimentSummary = {
  slug: string;
  name: string | null;
  variantKey: string;
  variantName: string | null;
  isControl: boolean;
  assignmentStrategy: string | null;
  status: string | null;
  featureFlagKey: string | null;
};

export type OrderReceiptPayload = Pick<
  AdminOrder,
  "id" | "orderNumber" | "status" | "total" | "currency" | "createdAt" | "updatedAt" | "notes" | "loyaltyProjectionPoints"
> & {
  items: AdminOrder["items"];
  pricingExperiments: OrderPricingExperimentSummary[];
  deliveryProof: OrderDeliveryProof | null;
  deliveryProofAggregates: DeliveryProofAggregateResponse | null;
  receiptStorageKey: string | null;
  receiptStorageUrl: string | null;
  receiptStorageUploadedAt: string | null;
  providerTelemetry: ProviderAutomationTelemetry | null;
};

export type BuildOrderReceiptOptions = {
  deliveryProof?: OrderDeliveryProof | null;
  deliveryProofAggregates?: DeliveryProofAggregateResponse | null;
};

export const buildOrderReceiptPayload = (
  order: AdminOrder,
  options: BuildOrderReceiptOptions = {}
): OrderReceiptPayload => {
  const itemIds = new Set(order.items.map((item) => item.id));
  const productIds = new Set(
    order.items
      .map((item) => item.productId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );

  const filteredDeliveryProof = options.deliveryProof
    ? {
        ...options.deliveryProof,
        items: options.deliveryProof.items.filter((item) => itemIds.has(item.itemId)),
      }
    : null;

  const filteredAggregates = options.deliveryProofAggregates
    ? {
        generatedAt: options.deliveryProofAggregates.generatedAt,
        windowDays: options.deliveryProofAggregates.windowDays,
        products: options.deliveryProofAggregates.products.filter((product) =>
          productIds.has(product.productId)
        ),
      }
    : null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.total,
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    notes: order.notes,
    loyaltyProjectionPoints: order.loyaltyProjectionPoints,
    items: order.items,
    pricingExperiments: extractPricingExperiments(order),
    deliveryProof: filteredDeliveryProof,
    deliveryProofAggregates: filteredAggregates,
    receiptStorageKey: order.receiptStorageKey,
    receiptStorageUrl: order.receiptStorageUrl,
    receiptStorageUploadedAt: order.receiptStorageUploadedAt,
    providerTelemetry: order.providerOrders.length
      ? summarizeProviderAutomationTelemetry(order.providerOrders)
      : null,
  };
};

export const buildOrderJsonDownloadHref = (
  order: AdminOrder,
  options: BuildOrderReceiptOptions = {}
): string => {
  const payload = JSON.stringify(buildOrderReceiptPayload(order, options), null, 2);
  return `data:application/json;base64,${Buffer.from(payload).toString("base64")}`;
};

export const getOrderDownloadFilename = (order: AdminOrder): string => {
  const reference = order.orderNumber || order.id;
  return `smplat-order-${reference}.json`;
};

const parsePricingExperimentAttribute = (raw: unknown): OrderPricingExperimentSummary | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const slug = typeof raw.slug === "string" ? raw.slug : null;
  const variantKey = typeof raw.variantKey === "string" ? raw.variantKey : null;
  if (!slug || !variantKey) {
    return null;
  }
  const assignmentStrategy =
    typeof raw.assignmentStrategy === "string"
      ? raw.assignmentStrategy
      : typeof raw.assignment_strategy === "string"
        ? raw.assignment_strategy
        : null;
  return {
    slug,
    name: typeof raw.name === "string" ? raw.name : null,
    variantKey,
    variantName: typeof raw.variantName === "string" ? raw.variantName : null,
    isControl:
      typeof raw.isControl === "boolean"
        ? raw.isControl
        : typeof raw.is_control === "boolean"
          ? raw.is_control
          : false,
    assignmentStrategy,
    status: typeof raw.status === "string" ? raw.status : null,
    featureFlagKey:
      typeof raw.featureFlagKey === "string"
        ? raw.featureFlagKey
        : typeof raw.feature_flag_key === "string"
          ? raw.feature_flag_key
          : null,
  };
};

const extractPricingExperiments = (order: AdminOrder): OrderPricingExperimentSummary[] => {
  const segments = new Map<string, OrderPricingExperimentSummary>();
  order.items.forEach((item) => {
    if (!item.attributes || !isRecord(item.attributes)) {
      return;
    }
    const attributes = item.attributes as Record<string, unknown>;
    const experimentPayload =
      attributes.pricingExperiment ?? attributes.pricing_experiment ?? null;
    const parsed = parsePricingExperimentAttribute(experimentPayload);
    if (parsed) {
      segments.set(parsed.slug, parsed);
    }
  });
  return Array.from(segments.values());
};
