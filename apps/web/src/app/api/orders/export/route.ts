import { NextResponse } from "next/server";

import { buildOrderReceiptPayload } from "@/lib/orders/receipt-exports";
import { requireRole } from "@/server/auth/policies";
import { fetchDeliveryProofAggregates } from "@/server/metrics/delivery-proof-aggregates";
import { fetchAdminOrders } from "@/server/orders/admin-orders";
import { fetchOrderDeliveryProof } from "@/server/orders/delivery-proof";

const MAX_LIMIT = 250;
const DEFAULT_LIMIT = 100;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    await requireRole("operator", {
      context: {
        route: "api.orders.export",
        method: "GET"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const orders = await fetchAdminOrders(limit);
    const productIds = Array.from(
      new Set(
        orders
          .flatMap((order) => order.items.map((item) => item.productId))
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    const deliveryProofsPromise = Promise.all(orders.map((order) => fetchOrderDeliveryProof(order.id)));
    const aggregatesPromise = productIds.length ? fetchDeliveryProofAggregates(productIds) : Promise.resolve(null);
    const [deliveryProofs, aggregates] = await Promise.all([deliveryProofsPromise, aggregatesPromise]);

    const payload = orders.map((order, index) =>
      buildOrderReceiptPayload(order, {
        deliveryProof: deliveryProofs[index],
        deliveryProofAggregates: aggregates,
      })
    );
    const body = JSON.stringify(payload, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="smplat-orders-export-${timestamp}.json"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.warn("Failed to export orders", error);
    return NextResponse.json({ error: "Unable to export orders" }, { status: 500 });
  }
}
