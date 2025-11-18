import { NextResponse } from "next/server";

import { fetchGuardrailFollowUps, recordGuardrailFollowUp } from "@/server/reporting/guardrail-followups";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      providerId?: string;
      providerName?: string | null;
      action?: string;
      notes?: string | null;
      platformContext?: {
        id: string;
        label: string;
        handle?: string | null;
        platformType?: string | null;
      } | null;
      conversionCursor?: string | null;
      conversionHref?: string | null;
      attachments?: Array<{
        id: string;
        fileName: string;
        assetUrl: string;
        storageKey: string;
        size?: number | null;
        contentType?: string | null;
        uploadedAt?: string | null;
      }> | null;
    };
    const providerId = typeof body.providerId === "string" && body.providerId.trim().length > 0 ? body.providerId : null;
    const action = typeof body.action === "string" && body.action.trim().length > 0 ? body.action : null;
    if (!providerId || !action) {
      return NextResponse.json({ error: "providerId and action are required" }, { status: 400 });
    }

    const record = await recordGuardrailFollowUp({
      providerId,
      providerName: typeof body.providerName === "string" ? body.providerName : null,
      action,
      notes: typeof body.notes === "string" ? body.notes : null,
      platformContext: body.platformContext ?? null,
      conversionCursor: typeof body.conversionCursor === "string" ? body.conversionCursor : null,
      conversionHref: typeof body.conversionHref === "string" ? body.conversionHref : null,
      attachments: Array.isArray(body.attachments) ? body.attachments : null,
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("Failed to record guardrail follow-up", error);
    return NextResponse.json({ error: "Unable to record guardrail follow-up" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("providerId");
  if (!providerId) {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 });
  }
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : null;
  const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
  const cursor = searchParams.get("cursor");

  try {
    const feed = await fetchGuardrailFollowUps({
      providerId,
      limit,
      cursor,
    });
    return NextResponse.json(feed, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch guardrail follow-ups", error);
    return NextResponse.json({ error: "Unable to load guardrail follow-ups" }, { status: 500 });
  }
}
