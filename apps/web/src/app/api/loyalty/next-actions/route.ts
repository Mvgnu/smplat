import { NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { fetchCheckoutNextActions } from "@/server/loyalty/intents";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const feed = await fetchCheckoutNextActions(session.user.id);
    return NextResponse.json(feed);
  } catch (error) {
    console.warn("Failed to load checkout next actions", error);
    return NextResponse.json({ error: "Failed to load checkout next actions" }, { status: 500 });
  }
}
