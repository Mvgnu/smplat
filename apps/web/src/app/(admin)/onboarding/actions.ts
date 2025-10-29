"use server";

// meta: module: admin-onboarding-actions

import { revalidatePath } from "next/cache";

import { requireRole } from "@/server/auth/policies";
import { dispatchOperatorManualNudge } from "@/server/onboarding/journeys";
import { ensureCsrfToken } from "@/server/security/csrf";

export type ManualNudgeInput = {
  journeyId: string;
  channel: string;
  subject: string;
  message: string;
  taskId?: string | null;
  operator: string;
  csrfToken: string;
};

export async function sendManualNudge(input: ManualNudgeInput): Promise<void> {
  await requireRole("operator");
  ensureCsrfToken({ tokenFromForm: input.csrfToken });

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
