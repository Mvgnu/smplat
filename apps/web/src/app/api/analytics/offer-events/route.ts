import { NextResponse } from "next/server";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const analyticsApiKey =
  process.env.CHECKOUT_API_KEY ??
  process.env.AUTH_API_KEY ??
  process.env.NEXT_PUBLIC_AUTH_API_KEY ??
  undefined;

function buildHeaders(initHeaders: HeadersInit | undefined): Headers {
  const headers = new Headers(initHeaders ?? {});
  headers.set("Content-Type", "application/json");
  if (analyticsApiKey) {
    headers.set("X-API-Key", analyticsApiKey);
  }
  return headers;
}

function normalizeCartTotal(cartTotal: unknown): string | undefined {
  if (typeof cartTotal !== "number" || Number.isNaN(cartTotal) || !Number.isFinite(cartTotal)) {
    return undefined;
  }
  return cartTotal.toFixed(2);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const offerSlug = normalizeString(body.offerSlug);
    const eventType = normalizeString(body.eventType);

    if (!offerSlug || !eventType) {
      return NextResponse.json({ error: "offerSlug and eventType are required" }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      offer_slug: offerSlug,
      event_type: eventType,
    };

    const targetSlug = normalizeString(body.targetSlug);
    if (targetSlug) payload.target_slug = targetSlug;

    const action = normalizeString(body.action);
    if (action) payload.action = action;

    const cartTotal = normalizeCartTotal(body.cartTotal);
    if (cartTotal) payload.cart_total = cartTotal;

    const currency = normalizeString(body.currency);
    if (currency) payload.currency = currency.toUpperCase();

    if (body.metadata && typeof body.metadata === "object") {
      payload.metadata = body.metadata;
    }

    if (body.orderReference && typeof body.orderReference === "string") {
      const reference = body.orderReference.trim();
      if (reference) {
        payload.order_reference = reference;
      }
    }

    const response = await fetch(`${apiBaseUrl}/api/v1/analytics/offer-events`, {
      method: "POST",
      headers: buildHeaders(undefined),
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      console.error("Failed to proxy offer event analytics", {
        status: response.status,
        statusText: response.statusText,
        detail: errorBody,
      });
      return NextResponse.json(
        { error: "Failed to record event", detail: errorBody ?? null },
        { status: 502 }
      );
    }

    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error("Failed to record offer event", error);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (typeof data === "object" && data !== null) {
      if ("detail" in data && typeof data.detail === "string") {
        return data.detail;
      }
      return JSON.stringify(data);
    }
    return String(data);
  } catch {
    try {
      const text = await response.text();
      return text || null;
    } catch {
      return null;
    }
  }
}
