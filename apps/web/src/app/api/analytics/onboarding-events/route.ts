import { NextResponse } from "next/server";

import {
  ensureOnboardingJourney,
  toggleOnboardingTask,
  recordOnboardingReferral,
} from "@/server/onboarding/journeys";

type ChecklistUpdatePayload = {
  orderId?: string;
  taskId?: string;
  completed?: boolean;
};

type JourneyStartedPayload = {
  orderId?: string;
} & Record<string, unknown>;

type ReferralPayload = {
  orderId?: string;
  referralCode?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const eventType = typeof body.eventType === "string" ? body.eventType : undefined;

    if (!eventType) {
      return NextResponse.json({ error: "eventType is required" }, { status: 400 });
    }

    if (eventType === "journey_started") {
      const payload = body as JourneyStartedPayload;
      const orderId = typeof payload.orderId === "string" ? payload.orderId : undefined;
      if (!orderId) {
        return NextResponse.json({ error: "orderId is required" }, { status: 400 });
      }

      const journey = await ensureOnboardingJourney(orderId, body);
      return NextResponse.json({ status: "ok", journey });
    }

    if (eventType === "checklist_update") {
      const payload = body as ChecklistUpdatePayload;
      const orderId = typeof payload.orderId === "string" ? payload.orderId : undefined;
      const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
      const completed = typeof payload.completed === "boolean" ? payload.completed : undefined;

      if (!orderId || !taskId || typeof completed !== "boolean") {
        return NextResponse.json(
          { error: "orderId, taskId, and completed are required" },
          { status: 400 }
        );
      }

      const task = await toggleOnboardingTask(orderId, taskId, completed);
      return NextResponse.json({ status: "ok", task });
    }

    if (eventType === "referral_copied") {
      const payload = body as ReferralPayload;
      const orderId = typeof payload.orderId === "string" ? payload.orderId : undefined;
      const referralCode = typeof payload.referralCode === "string" ? payload.referralCode : undefined;

      if (!orderId || !referralCode) {
        return NextResponse.json({ error: "orderId and referralCode are required" }, { status: 400 });
      }

      await recordOnboardingReferral(orderId, referralCode);
      return NextResponse.json({ status: "ok" });
    }

    return NextResponse.json({ error: `Unsupported eventType: ${eventType}` }, { status: 400 });
  } catch (error) {
    console.error("Failed to record onboarding event", error);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
