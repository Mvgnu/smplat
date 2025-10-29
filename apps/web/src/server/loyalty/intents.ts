import "server-only";

import type { LoyaltyIntentConfirmationPayload } from "@smplat/types";

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

export type CheckoutIntentSubmission = LoyaltyIntentConfirmationPayload & {
  userId: string;
};

export async function submitCheckoutIntents(payload: CheckoutIntentSubmission): Promise<void> {
  if (!checkoutApiKey) {
    console.warn("Skipping checkout intent submission because CHECKOUT_API_KEY is not configured");
    return;
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
}
