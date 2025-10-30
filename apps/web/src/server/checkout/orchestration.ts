import "server-only";

// meta: module: checkout-orchestration-fetcher

import type { CheckoutOrchestration } from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

function buildBypassOrchestration(orderId: string): CheckoutOrchestration {
  const now = new Date();
  return {
    orderId,
    currentStage: "payment",
    status: "waiting",
    startedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    completedAt: null,
    failedAt: null,
    nextActionAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    metadata: {
      lastRecoveryStage: "payment",
      hint: "Bypass orchestration data"
    },
    events: [
      {
        stage: "payment",
        status: "not_started",
        note: "Orchestration seeded for bypass",
        payload: {},
        createdAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString()
      },
      {
        stage: "payment",
        status: "waiting",
        note: "Waiting for verification",
        payload: { reason: "awaiting_verification" },
        createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString()
      }
    ]
  } satisfies CheckoutOrchestration;
}

export async function fetchCheckoutOrchestration(
  orderId: string
): Promise<CheckoutOrchestration | null> {
  if (!orderId) {
    return null;
  }

  if (!apiKeyHeader) {
    return buildBypassOrchestration(orderId);
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/checkout/orchestrations/${orderId}`, {
    cache: "no-store",
    headers: defaultHeaders
  });

  if (!response.ok) {
    throw new Error(`Failed to load checkout orchestration: ${response.statusText}`);
  }

  return (await response.json()) as CheckoutOrchestration;
}
