import "server-only";

import type {
  DeliveryProofAccount,
  DeliveryProofItem,
  DeliveryProofSnapshot,
  OrderDeliveryProof,
} from "@/types/delivery-proof";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const headers: HeadersInit = checkoutApiKey ? { "X-API-Key": checkoutApiKey } : {};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toSnapshot = (value: unknown): DeliveryProofSnapshot | null => {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  return {
    metrics: toRecord(record.metrics) ?? record,
    recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : typeof record.scrapedAt === "string" ? record.scrapedAt : null,
    source: typeof record.source === "string" ? record.source : null,
    warnings: Array.isArray(record.warnings) ? (record.warnings as string[]) : [],
  };
};

export async function fetchOrderDeliveryProof(orderId: string): Promise<OrderDeliveryProof | null> {
  if (!orderId || !checkoutApiKey) {
    return null;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/delivery-proof`, {
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as OrderDeliveryProof;
    return {
      ...payload,
      items: payload.items.map((item) => ({
        itemId: item.itemId,
        productTitle: item.productTitle,
        platformContext: toRecord(item.platformContext),
        account: item.account
          ? {
              ...item.account,
              metadata: toRecord(item.account.metadata) ?? {},
            }
          : null,
        baseline: toSnapshot(item.baseline),
        latest: toSnapshot(item.latest),
        history: Array.isArray(item.history) ? item.history.map((entry) => toSnapshot(entry)).filter(Boolean) as DeliveryProofSnapshot[] : [],
      })),
    };
  } catch (error) {
    console.warn("Failed to fetch order delivery proof", { orderId, error });
    return null;
  }
}
