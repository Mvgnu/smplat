import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/client";

const ensureOnboardingTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS onboarding_journey_events (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      order_reference TEXT,
      event_type TEXT NOT NULL,
      task_id TEXT,
      completed BOOLEAN,
      metadata JSONB
    )
  `);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const eventType = typeof body.eventType === "string" ? body.eventType : undefined;

    if (!eventType) {
      return NextResponse.json({ error: "eventType is required" }, { status: 400 });
    }

    await ensureOnboardingTable();

    const eventId = crypto.randomUUID();
    const orderReference = typeof body.orderId === "string" ? body.orderId : null;
    const taskId = typeof body.taskId === "string" ? body.taskId : null;
    const completed = typeof body.completed === "boolean" ? body.completed : null;
    const metadata = body.referralCode || body.metadata ? { referralCode: body.referralCode, ...body.metadata } : null;

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO onboarding_journey_events (id, order_reference, event_type, task_id, completed, metadata)
        VALUES (${eventId}::uuid, ${orderReference}, ${eventType}, ${taskId}, ${completed}, ${JSON.stringify(metadata)})
      `
    );

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Failed to record onboarding event", error);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
