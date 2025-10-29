import { NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { resolveCheckoutIntent } from "@/server/loyalty/intents";

export async function POST(
  request: Request,
  { params }: { params: { intentId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { status } = (await request.json().catch(() => ({ status: "resolved" }))) as {
    status?: "resolved" | "cancelled";
  };

  try {
    const intent = await resolveCheckoutIntent(
      params.intentId,
      session.user.id,
      status === "cancelled" ? "cancelled" : "resolved"
    );
    return NextResponse.json(intent);
  } catch (error) {
    console.warn("Failed to resolve checkout intent", error);
    return NextResponse.json({ error: "Failed to resolve checkout intent" }, { status: 500 });
  }
}
