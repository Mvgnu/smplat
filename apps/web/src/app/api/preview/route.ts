import { draftMode } from "next/headers";
import { NextResponse } from "next/server";

const PREVIEW_SECRET = process.env.SANITY_PREVIEW_SECRET;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const redirect = searchParams.get("redirect") ?? "/";

  if (!PREVIEW_SECRET || secret !== PREVIEW_SECRET) {
    return NextResponse.json({ error: "Invalid preview secret" }, { status: 401 });
  }

  draftMode().enable();

  return NextResponse.redirect(new URL(redirect, request.url));
}

export async function DELETE() {
  draftMode().disable();
  return NextResponse.json({ preview: false });
}
