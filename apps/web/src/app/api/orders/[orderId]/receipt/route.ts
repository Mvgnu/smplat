import { renderOrderReceiptPdf } from "@/lib/orders/receipt-pdf";
import { loadOrderReceipt } from "@/lib/orders/receipt-service";

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  const { orderId } = params;
  if (!orderId) {
    return buildJsonResponse({ error: "Missing order identifier." }, { status: 400 });
  }

  try {
    const receipt = await loadOrderReceipt(orderId);
    if (!receipt) {
      return buildJsonResponse({ error: "Order not found." }, { status: 404 });
    }

    const pdfBuffer = await renderOrderReceiptPdf(receipt);
    const filename = `smplat-order-${receipt.orderNumber ?? receipt.id}.pdf`;
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.warn("Failed to generate order receipt PDF", orderId, error);
    return buildJsonResponse({ error: "Unable to build receipt PDF." }, { status: 500 });
  }
}

const buildJsonResponse = (body: unknown, init?: ResponseInit): Response => {
  const normalized: Record<string, string> = { "Content-Type": "application/json" };
  const headersInit = init?.headers;
  if (Array.isArray(headersInit)) {
    headersInit.forEach(([key, value]) => {
      normalized[key] = value;
    });
  } else if (headersInit && typeof headersInit === "object") {
    if (typeof Headers !== "undefined" && headersInit instanceof Headers) {
      headersInit.forEach((value, key) => {
        normalized[key] = value;
      });
    } else {
      Object.assign(normalized, headersInit as Record<string, string>);
    }
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers: normalized,
  });
};
