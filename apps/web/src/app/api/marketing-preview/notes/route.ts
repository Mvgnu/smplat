// meta: route: api/marketing-preview/notes
// meta: feature: marketing-preview-cockpit

import { NextResponse } from "next/server";

import {
  createMarketingPreviewNote,
  getMarketingPreviewNotes,
  type MarketingPreviewTriageNoteInput
} from "@/server/cms/preview/notes";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sanitizeInput = (input: MarketingPreviewTriageNoteInput) => ({
  ...input,
  route: input.route.trim(),
  generatedAt: input.generatedAt.trim(),
  body: input.body.trim(),
  author: input.author?.trim()
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const generatedAt = searchParams.get("generatedAt") ?? undefined;
  const route = searchParams.get("route") ?? undefined;

  const notes = await getMarketingPreviewNotes({ generatedAt, route });
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as MarketingPreviewTriageNoteInput | null;

  if (!payload) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { route, generatedAt, body, author, severity } = payload;

  if (!isNonEmptyString(route) || !isNonEmptyString(generatedAt) || !isNonEmptyString(body)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const note = await createMarketingPreviewNote(
    sanitizeInput({ route, generatedAt, body, author: author ?? undefined, severity })
  );

  return NextResponse.json({ note }, { status: 201 });
}
