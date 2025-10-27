import { headers } from "next/headers";
import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export async function POST(request: Request, { params }: { params: { stagingId: string } }) {
  if (!checkoutApiKey) {
    return NextResponse.json({ error: "Reconciliation requeue is disabled." }, { status: 503 });
  }

  const upstreamUrl = `${apiBaseUrl}/api/v1/billing/reconciliation/staging/${params.stagingId}/requeue`;
  const payload = await request.json().catch(() => ({}));

  const forwardHeaders = new Headers();
  forwardHeaders.set("X-API-Key", checkoutApiKey);
  forwardHeaders.set("content-type", "application/json");

  const incoming = headers();
  ["traceparent", "x-request-id"].forEach((key) => {
    const value = incoming.get(key);
    if (value) {
      forwardHeaders.set(key, value);
    }
  });

  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: forwardHeaders,
      cache: "no-store",
      body: JSON.stringify(payload ?? {}),
    });

    const body = await response.json().catch(() => ({ error: "Failed to requeue staging entry." }));
    if (!response.ok) {
      return NextResponse.json({ error: body.detail ?? body.error ?? "Requeue failed." }, { status: response.status });
    }

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to requeue staging entry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
