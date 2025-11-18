import "server-only";

import type { DeliveryProofAggregateResponse } from "@/types/delivery-proof";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey =
  process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

const headers: HeadersInit = checkoutApiKey ? { "X-API-Key": checkoutApiKey } : {};

export async function fetchDeliveryProofAggregates(
  productIds?: string[],
  windowDays = 90,
): Promise<DeliveryProofAggregateResponse | null> {
  if (!checkoutApiKey) {
    return null;
  }

  try {
    const url = new URL(`${apiBaseUrl}/api/v1/orders/delivery-proof/metrics`);
    url.searchParams.set("windowDays", windowDays.toString());
    if (productIds && productIds.length) {
      productIds.forEach((id) => url.searchParams.append("productId", id));
    }
    const response = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as DeliveryProofAggregateResponse;
    return payload;
  } catch (error) {
    console.warn("Failed to fetch delivery proof aggregates", error);
    return null;
  }
}
