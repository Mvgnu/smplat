import { NextResponse } from "next/server";

import type { LoyaltyIntentConfirmationPayload } from "@smplat/types";
import { auth } from "@/server/auth";
import { submitCheckoutIntents } from "@/server/loyalty/intents";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: LoyaltyIntentConfirmationPayload;
  try {
    payload = (await request.json()) as LoyaltyIntentConfirmationPayload;
  } catch (error) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload.orderId || !Array.isArray(payload.intents)) {
    return NextResponse.json({ error: "orderId and intents are required" }, { status: 400 });
  }

  try {
    const feed = await submitCheckoutIntents({ ...payload, userId: session.user.id });
    return NextResponse.json(feed);
  } catch (error) {
    console.warn("Failed to submit checkout loyalty intents", error);
    return NextResponse.json({ error: "Failed to sync loyalty intents" }, { status: 500 });
  }
}
