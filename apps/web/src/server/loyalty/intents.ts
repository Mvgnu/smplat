import "server-only";

import type {
  LoyaltyCheckoutIntent,
  LoyaltyIntentConfirmationPayload,
  LoyaltyNextActionFeed
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (checkoutApiKey) {
    headers["X-API-Key"] = checkoutApiKey;
  }
  return headers;
}

export type CheckoutIntentSubmission = LoyaltyIntentConfirmationPayload;

export async function submitCheckoutIntents(
  payload: CheckoutIntentSubmission
): Promise<LoyaltyNextActionFeed> {
  if (!checkoutApiKey) {
    console.warn("Skipping checkout intent submission because CHECKOUT_API_KEY is not configured");
    return { intents: [], cards: [] };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/loyalty/checkout/intents`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to submit checkout loyalty intents");
  }

  return (await response.json()) as LoyaltyNextActionFeed;
}

export async function fetchCheckoutNextActions(userId: string): Promise<LoyaltyNextActionFeed> {
  const response = await fetch(`${apiBaseUrl}/api/v1/loyalty/next-actions`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Session-User": userId
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load checkout next actions");
  }

  return (await response.json()) as LoyaltyNextActionFeed;
}

export async function resolveCheckoutIntent(
  intentId: string,
  userId: string,
  status: "resolved" | "cancelled"
): Promise<LoyaltyCheckoutIntent> {
  const response = await fetch(`${apiBaseUrl}/api/v1/loyalty/next-actions/${intentId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-User": userId
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to resolve checkout intent");
  }

  return (await response.json()) as LoyaltyCheckoutIntent;
}
