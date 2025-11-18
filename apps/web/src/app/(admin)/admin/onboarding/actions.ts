"use server";

import { redirect } from "next/navigation";

import { requireRole } from "@/server/auth/policies";
import { dispatchOperatorManualNudge } from "@/server/onboarding/journeys";
import { ensureCsrfToken } from "@/server/security/csrf";

export type ManualNudgeInput = {
  journeyId: string;
  channel: "email" | "slack";
  subject: string;
  message: string;
  taskId?: string | null;
  operator: string;
  csrfToken: string;
};

export async function clearExperimentConversionsCursor(formData: FormData): Promise<void> {
  const redirectTo = formData.get("redirectTo");
  const destination =
    typeof redirectTo === "string" && redirectTo.trim().length > 0
      ? redirectTo.trim()
      : "/admin/onboarding#experiment-analytics";
  redirect(destination);
}

export async function sendManualNudge(input: ManualNudgeInput): Promise<void> {
  await requireRole("operator", {
    context: { route: "admin.onboarding.manualNudge", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: input.csrfToken });

  if (!input.journeyId) {
    throw new Error("Journey identifier is required.");
  }
  const subject = input.subject?.trim();
  const operator = input.operator?.trim();
  const message = input.message?.trim();

  if (!subject) {
    throw new Error("Subject is required.");
  }
  if (!message) {
    throw new Error("Message body is required.");
  }
  if (!operator) {
    throw new Error("Operator signature is required.");
  }

  const channel: "email" | "slack" = input.channel === "slack" ? "slack" : "email";

  await dispatchOperatorManualNudge(input.journeyId, {
    channel,
    subject,
    message,
    taskId: input.taskId ?? null,
    triggeredBy: operator,
  });
}
