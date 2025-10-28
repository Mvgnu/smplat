"use server";

// meta: module: admin-onboarding-actions

import { revalidatePath } from "next/cache";

import { dispatchOperatorManualNudge } from "@/server/onboarding/journeys";

export type ManualNudgeInput = {
  journeyId: string;
  channel: string;
  subject: string;
  message: string;
  taskId?: string | null;
  operator: string;
};

export async function sendManualNudge(input: ManualNudgeInput): Promise<void> {
  if (!input.journeyId) {
    throw new Error("journeyId is required to dispatch nudges");
  }

  await dispatchOperatorManualNudge(input.journeyId, {
    channel: input.channel,
    subject: input.subject,
    message: input.message,
    taskId: input.taskId,
    triggeredBy: input.operator,
  });

  revalidatePath("/admin/onboarding");
}
