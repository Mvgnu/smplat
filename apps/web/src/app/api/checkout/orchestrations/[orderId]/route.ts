import { NextResponse } from "next/server";

// meta: route: api/checkout/orchestration

import { fetchCheckoutOrchestration } from "@/server/checkout/orchestration";

export async function GET(
  _request: Request,
  context: { params: { orderId?: string } }
) {
  const orderId = context.params.orderId;
  if (!orderId) {
    return NextResponse.json({ error: "order id required" }, { status: 400 });
  }

  try {
    const orchestration = await fetchCheckoutOrchestration(orderId);
    if (!orchestration) {
      return NextResponse.json({ error: "order id required" }, { status: 400 });
    }

    return NextResponse.json(orchestration);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load checkout orchestration";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
