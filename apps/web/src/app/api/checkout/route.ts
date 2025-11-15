"use server";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { fetchProductJourneyRuntime, triggerJourneyComponentRun } from "@/server/journey-runtime";

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

type JourneyCartItem = {
  productId: string;
  slug: string;
  quantity: number;
  trustSignal?: {
    value: string;
    label: string;
  } | null;
  loyaltyHint?: {
    value: string;
    reward: string;
    pointsEstimate?: number;
    progress?: number;
  } | null;
  pointsTotal?: number;
  journeyInsight?: string | null;
  highlights?: string[];
  sla?: string | null;
};

type JourneyContextPayload = {
  channel?: string;
  cart?: JourneyCartItem[];
  form?: Record<string, unknown>;
  loyalty?: Record<string, unknown> | null;
  loyaltyProjection?: {
    projectedPoints: number;
  };
  intents?: Array<Record<string, unknown>>;
  rewards?: Array<Record<string, unknown>>;
  plannedRewardSlug?: string | null;
  referralPlanEnabled?: boolean;
  pricingExperiments?: Array<Record<string, unknown>>;
};

type CheckoutRequestBody = {
  order: Record<string, unknown>;
  payment?: {
    customer_email?: string;
    success_url?: string;
    cancel_url?: string;
  };
  journeyContext?: JourneyContextPayload;
};

if (!apiBaseUrl) {
  throw new Error("API_BASE_URL is not configured");
}

export async function POST(request: Request) {
  const forwardHeaders = new Headers();

  // Propagate trace headers if available (optional).
  const incomingHeaders = headers();
  ["traceparent", "x-request-id"].forEach((key) => {
    const value = incomingHeaders.get(key);
    if (value) {
      forwardHeaders.set(key, value);
    }
  });

  if (checkoutApiKey) {
    forwardHeaders.set("X-API-Key", checkoutApiKey);
  }

  forwardHeaders.set("Content-Type", "application/json");

  const body = (await request.json()) as CheckoutRequestBody;

  try {
    const orderResponse = await fetch(`${apiBaseUrl}/api/v1/orders`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body.order),
      cache: "no-store"
    });

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorBody.detail ?? "Failed to create order" },
        { status: orderResponse.status }
      );
    }

    const orderData = await orderResponse.json();
    const origin = request.headers.get("origin") ?? "";
    const successUrlRaw = body.payment?.success_url ?? `${origin}/checkout/success`;
    const cancelUrl = body.payment?.cancel_url ?? `${origin}/checkout`;

    let normalizedSuccessUrl: URL;
    try {
      normalizedSuccessUrl = new URL(successUrlRaw);
    } catch {
      normalizedSuccessUrl = new URL(successUrlRaw, origin || "http://localhost:3000");
    }
    normalizedSuccessUrl.searchParams.set("order", orderData.id);

    const paymentResponse = await fetch(`${apiBaseUrl}/api/v1/payments/checkout`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify({
        order_id: orderData.id,
        success_url: normalizedSuccessUrl.toString(),
        cancel_url: cancelUrl,
        customer_email: body.payment?.customer_email
      }),
      cache: "no-store"
    });

    if (!paymentResponse.ok) {
      const errorBody = await paymentResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorBody.detail ?? "Failed to initiate checkout" },
        { status: paymentResponse.status }
      );
    }

    const checkoutData = await paymentResponse.json();

    triggerCheckoutJourneyRuns(orderData, body.journeyContext).catch((error) => {
      console.warn("Failed to trigger journey runtime after checkout", error);
    });

    return NextResponse.json({
      order: orderData,
      payment: checkoutData
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function triggerCheckoutJourneyRuns(
  order: { items?: Array<Record<string, unknown>>; order_number?: string } | null,
  context?: JourneyContextPayload
): Promise<void> {
  if (!order?.items?.length) {
    return;
  }

  const normalizedCart = context?.cart
    ? context.cart.map((item) => ({
        ...item,
        loyaltyHint: item.loyaltyHint
          ? {
              ...item.loyaltyHint,
              pointsEstimate:
                typeof item.loyaltyHint.pointsEstimate === "number" ? item.loyaltyHint.pointsEstimate : null
            }
          : null,
        pointsTotal: typeof item.pointsTotal === "number" ? item.pointsTotal : null
      }))
    : null;

  const productIds = Array.from(
    new Set(
      order.items
        .map((item) => {
          const productId = item.product_id ?? item.productId;
          return typeof productId === "string" ? productId : null;
        })
        .filter((id): id is string => Boolean(id))
    )
  );

  if (productIds.length === 0) {
    return;
  }

  await Promise.all(
    productIds.map(async (productId) => {
      const runtime = await fetchProductJourneyRuntime(productId);
      if (!runtime) {
        return;
      }
      const assignments = (runtime.journeyComponents ?? []).filter((component) =>
        isCheckoutEligible(component.channelEligibility)
      );
      if (!assignments.length) {
        return;
      }
      const matchingOrderItems = order.items?.filter(
        (item) => item.product_id === productId || item.productId === productId
      );

      await Promise.all(
        assignments.map(async (assignment) => {
          const payload = {
            componentId: assignment.componentId,
            productId,
            productComponentId: assignment.id,
            channel: "checkout",
            inputPayload: {
              order,
              orderItems: matchingOrderItems,
              cart: normalizedCart,
              form: context?.form ?? null,
              loyalty: context?.loyalty ?? null,
              intents: context?.intents ?? null,
              rewards: context?.rewards ?? null,
              loyaltyProjection: context?.loyaltyProjection ?? null,
              cartPointsTotal: normalizedCart?.reduce((acc, item) => acc + (item.pointsTotal ?? 0), 0) ?? null,
            },
            metadata: {
              source: "checkout",
              orderNumber: order.order_number ?? null,
              componentKey: assignment.component?.key ?? null,
              plannedRewardSlug: context?.plannedRewardSlug ?? null,
              referralPlanEnabled: context?.referralPlanEnabled ?? false,
            },
            context: {
              checkout: {
                channel: context?.channel ?? "checkout",
                loyalty: context?.loyalty ?? null,
              },
            },
          };

          try {
            await triggerJourneyComponentRun(payload);
          } catch (error) {
            console.warn("Failed to enqueue journey run", { productId, componentId: assignment.componentId, error });
          }
        })
      );
    })
  );
}

function isCheckoutEligible(channels?: string[] | null): boolean {
  if (!channels || channels.length === 0) {
    return true;
  }
  return channels.some((channel) => channel?.toLowerCase() === "checkout");
}
