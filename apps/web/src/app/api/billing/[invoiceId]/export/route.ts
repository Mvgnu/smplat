import { headers } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export async function GET(
  request: Request,
  { params }: { params: { invoiceId: string } }
) {
  if (!checkoutApiKey) {
    return NextResponse.json({ error: "Billing exports are disabled." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const format = searchParams.get("format") ?? "csv";

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspace context." }, { status: 400 });
  }

  const upstreamUrl = `${apiBaseUrl}/api/v1/billing/invoices/${params.invoiceId}/export?workspace_id=${encodeURIComponent(
    workspaceId
  )}&format=${encodeURIComponent(format)}`;

  const forwardHeaders = new Headers();
  forwardHeaders.set("X-API-Key", checkoutApiKey);

  const incomingHeaders = headers();
  ["traceparent", "x-request-id"].forEach((key) => {
    const value = incomingHeaders.get(key);
    if (value) {
      forwardHeaders.set(key, value);
    }
  });

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: forwardHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: "Failed to export invoice" }));
      return NextResponse.json({ error: errorBody.detail ?? errorBody.message }, { status: response.status });
    }

    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "text/csv";
    const disposition = response.headers.get("content-disposition") ?? "attachment";

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to proxy invoice export";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
