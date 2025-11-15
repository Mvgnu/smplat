import { NextResponse } from "next/server";

import { buildOrderReceiptPayload } from "@/lib/orders/receipt-exports";
import { fetchAdminOrder } from "@/server/orders/admin-orders";

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  const { orderId } = params;

  if (!orderId) {
    return NextResponse.json({ error: "Missing order identifier." }, { status: 400 });
  }

  try {
    const order = await fetchAdminOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const summary = buildOrderReceiptPayload(order);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.warn("Failed to load order summary", orderId, error);
    return NextResponse.json({ error: "Unable to load order summary." }, { status: 500 });
  }
}
