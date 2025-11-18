import { formatDistanceToNow } from "date-fns";

import type {
  DeliveryProofAggregateResponse,
  DeliveryProofItem,
  DeliveryProofProductAggregate,
  DeliveryProofSnapshot,
  OrderDeliveryProof,
} from "@/types/delivery-proof";

export type DeliveryProofOrderItemReference = {
  id: string;
  productId: string | null;
  productTitle: string;
  platformContext?: {
    handle?: string | null;
    platformType?: string | null;
    label?: string | null;
  } | null;
};

export type DeliveryProofInsight = {
  item: DeliveryProofOrderItemReference;
  proof: DeliveryProofItem | null;
  aggregate: DeliveryProofProductAggregate | null;
};

export type DeliveryProofInsightContext = {
  proof?: OrderDeliveryProof | null;
  aggregates?: DeliveryProofAggregateResponse | null;
};

export function buildDeliveryProofInsights(
  items: DeliveryProofOrderItemReference[],
  context: DeliveryProofInsightContext = {}
): DeliveryProofInsight[] {
  if (!items.length) {
    return [];
  }
  const proofMap = new Map<string, DeliveryProofItem>();
  context.proof?.items?.forEach((entry) => {
    proofMap.set(entry.itemId, entry);
  });
  const aggregateMap = new Map<string, DeliveryProofProductAggregate>();
  context.aggregates?.products?.forEach((product) => {
    aggregateMap.set(product.productId, product);
  });

  return items
    .map((item) => {
      const proof = proofMap.get(item.id) ?? null;
      const aggregate = item.productId ? aggregateMap.get(item.productId) ?? null : null;
      if (!proof && !aggregate) {
        return null;
      }
      return { item, proof, aggregate } satisfies DeliveryProofInsight;
    })
    .filter((entry): entry is DeliveryProofInsight => entry != null);
}

export function extractMetricNumber(snapshot: DeliveryProofSnapshot | null | undefined, key: string): number | null {
  if (!snapshot?.metrics) {
    return null;
  }
  const value = snapshot.metrics[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatFollowerValue(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return followerNumberFormatter.format(value);
  }
  return "—";
}

export function formatSignedNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  const formatted = followerDeltaFormatter.format(value);
  if (value > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

export function formatRelativeTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

const followerNumberFormatter = new Intl.NumberFormat("en-US");
const followerDeltaFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
