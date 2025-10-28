import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/client";

const ensureOfferEventTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS checkout_offer_events (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      offer_slug TEXT NOT NULL,
      target_slug TEXT,
      event_type TEXT NOT NULL,
      action TEXT,
      cart_total NUMERIC(12, 2),
      currency TEXT,
      metadata JSONB
    )
  `);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const offerSlug = typeof body.offerSlug === "string" ? body.offerSlug : undefined;
    const eventType = typeof body.eventType === "string" ? body.eventType : undefined;

    if (!offerSlug || !eventType) {
      return NextResponse.json({ error: "offerSlug and eventType are required" }, { status: 400 });
    }

    await ensureOfferEventTable();

    const eventId = crypto.randomUUID();
    const targetSlug = typeof body.targetSlug === "string" ? body.targetSlug : null;
    const action = typeof body.action === "string" ? body.action : null;
    const cartTotal = typeof body.cartTotal === "number" ? body.cartTotal : null;
    const currency = typeof body.currency === "string" ? body.currency : null;
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO checkout_offer_events (id, offer_slug, target_slug, event_type, action, cart_total, currency, metadata)
        VALUES (${eventId}::uuid, ${offerSlug}, ${targetSlug}, ${eventType}, ${action}, ${cartTotal}, ${currency}, ${JSON.stringify(metadata)})
      `
    );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Failed to record offer event", error);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
