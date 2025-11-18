import "server-only";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const headers: HeadersInit = checkoutApiKey ? { "X-API-Key": checkoutApiKey } : {};

export type OrderStateEvent = {
  id: string;
  eventType: string;
  actorType: string | null;
  actorLabel: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ApiOrderStateEvent = {
  id: string;
  eventType: string;
  actorType?: string | null;
  actorLabel?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export async function fetchOrderStateEvents(orderId: string): Promise<OrderStateEvent[]> {
  if (!orderId || !checkoutApiKey) {
    return [];
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/state-events`, {
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as ApiOrderStateEvent[];
    return payload.map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      actorType: entry.actorType ?? null,
      actorLabel: entry.actorLabel ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      notes: entry.notes ?? null,
      metadata: toRecord(entry.metadata),
      createdAt: entry.createdAt,
    }));
  } catch (error) {
    console.warn("Failed to fetch order state events", { orderId, error });
    return [];
  }
}
