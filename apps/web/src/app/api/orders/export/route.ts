import { NextResponse } from "next/server";

import { buildOrderReceiptPayload } from "@/lib/orders/receipt-exports";
import { requireRole } from "@/server/auth/policies";
import { fetchAdminOrders } from "@/server/orders/admin-orders";

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
    const payload = orders.map((order) => buildOrderReceiptPayload(order));
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
