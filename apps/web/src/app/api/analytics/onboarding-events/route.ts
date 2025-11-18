import { NextResponse } from "next/server";

import {
  ensureOnboardingJourney,
  toggleOnboardingTask,
  recordOnboardingReferral,
  recordJourneyPricingExperiments,
  type JourneyPricingExperimentSegment,
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

    if (eventType === "pricing_experiment_segment") {
      const orderId = typeof body.orderId === "string" ? body.orderId : undefined;
      const experimentsInput = Array.isArray(body.experiments) ? body.experiments : [];
      if (!orderId || experimentsInput.length === 0) {
        return NextResponse.json(
          { error: "orderId and experiments are required" },
          { status: 400 },
        );
      }

      const normalized = experimentsInput
        .map((experiment): JourneyPricingExperimentSegment | null => {
          if (
            typeof experiment?.slug !== "string" ||
            typeof experiment?.variantKey !== "string"
          ) {
            return null;
          }
          return {
            slug: experiment.slug,
            variantKey: experiment.variantKey,
            variantName:
              typeof experiment.variantName === "string" ? experiment.variantName : null,
            isControl: typeof experiment.isControl === "boolean" ? experiment.isControl : undefined,
            assignmentStrategy:
              typeof experiment.assignmentStrategy === "string"
                ? experiment.assignmentStrategy
                : null,
          };
        })
        .filter((segment): segment is JourneyPricingExperimentSegment => Boolean(segment));

      if (normalized.length === 0) {
        return NextResponse.json(
          { error: "At least one valid experiment is required" },
          { status: 400 },
        );
      }

      await recordJourneyPricingExperiments(orderId, normalized);
      return NextResponse.json({ status: "accepted" });
    }

    return NextResponse.json({ error: `Unsupported eventType: ${eventType}` }, { status: 400 });
  } catch (error) {
    console.error("Failed to record onboarding event", error);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
