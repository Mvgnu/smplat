"use server";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

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

  const body = await request.json();

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
    const successUrl = body.payment?.success_url ?? `${request.headers.get("origin") ?? ""}/checkout/success`;
    const cancelUrl = body.payment?.cancel_url ?? `${request.headers.get("origin") ?? ""}/checkout`;

    const paymentResponse = await fetch(`${apiBaseUrl}/api/v1/payments/checkout`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify({
        order_id: orderData.id,
        success_url: `${successUrl}?order=${orderData.id}`,
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
    return NextResponse.json({
      order: orderData,
      payment: checkoutData
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
