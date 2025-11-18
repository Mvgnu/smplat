"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  accountValidationInitialState,
  guardrailExportTriggerInitialState,
  type AccountValidationActionState,
  type GuardrailExportTriggerState,
} from "@/lib/admin-report-actions-shared";
import { validateSocialAccount } from "@/server/metrics/metric-sourcer";
import type { SocialPlatformType } from "@/types/metrics";

const EXPORT_TRIGGER_URL = process.env.GUARDRAIL_EXPORT_TRIGGER_URL ?? null;
const EXPORT_TRIGGER_TOKEN = process.env.GUARDRAIL_EXPORT_TRIGGER_TOKEN ?? null;

export async function clearReportingConversionCursor(formData: FormData): Promise<void> {
  const redirectTo = formData.get("redirectTo");
  const destination =
    typeof redirectTo === "string" && redirectTo.trim().length > 0
      ? redirectTo.trim()
      : "/admin/reports#experiment-analytics";
  redirect(destination);
}

function parseNumberField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildManualMetrics(formData: FormData): Record<string, number | string> | null {
  const entries: Record<string, number | string> = {};
  const followerCount = parseNumberField(formData.get("manualFollowers"));
  if (followerCount !== null) entries.followers = followerCount;
  const followingCount = parseNumberField(formData.get("manualFollowing"));
  if (followingCount !== null) entries.followingCount = followingCount;
  const avgLikes = parseNumberField(formData.get("manualAvgLikes"));
  if (avgLikes !== null) entries.avgLikes = avgLikes;
  const avgComments = parseNumberField(formData.get("manualAvgComments"));
  if (avgComments !== null) entries.avgComments = avgComments;
  const engagementRate = parseNumberField(formData.get("manualEngagementRate"));
  if (engagementRate !== null) entries.engagementRatePct = engagementRate;
  const sampleSize = parseNumberField(formData.get("manualSampleSize"));
  if (sampleSize !== null) entries.sampleSize = sampleSize;
  const lastPostAt = formData.get("manualLastPostAt");
  if (typeof lastPostAt === "string" && lastPostAt.trim().length > 0) {
    entries.lastPostAt = lastPostAt.trim();
  }
  return Object.keys(entries).length > 0 ? entries : null;
}

export async function triggerGuardrailExportAction(
  _prevState: GuardrailExportTriggerState,
  formData: FormData,
): Promise<GuardrailExportTriggerState> {
  if (!EXPORT_TRIGGER_URL || !EXPORT_TRIGGER_TOKEN) {
    return {
      ...guardrailExportTriggerInitialState,
      status: "error",
      message: "Guardrail export trigger is not configured.",
    };
  }

  const csrfToken = formData.get("csrfToken");
  if (typeof csrfToken !== "string" || csrfToken.trim().length === 0) {
    return {
      ...guardrailExportTriggerInitialState,
      status: "error",
      message: "Missing CSRF token.",
    };
  }

  try {
    const response = await fetch(EXPORT_TRIGGER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EXPORT_TRIGGER_TOKEN}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Trigger request failed (${response.status})`);
    }
    revalidatePath("/admin/reports");
    return {
      status: "success",
      message: "Guardrail export workflow triggered.",
    };
  } catch (error) {
    console.warn("Failed to trigger guardrail export workflow", error);
    return {
      ...guardrailExportTriggerInitialState,
      status: "error",
      message: "Unable to trigger guardrail export. Try again shortly.",
    };
  }
}

export async function validateSocialAccountAction(
  _prevState: AccountValidationActionState,
  formData: FormData,
): Promise<AccountValidationActionState> {
  const handle = formData.get("handle");
  const platform = formData.get("platform");
  if (typeof handle !== "string" || handle.trim().length === 0 || typeof platform !== "string") {
    return {
      status: "error",
      message: "Platform and handle are required.",
      result: null,
    };
  }

  const customerProfileId = formData.get("customerProfileId");
  const metadataNotes = formData.get("metadataNotes");
  const metadata =
    typeof metadataNotes === "string" && metadataNotes.trim().length > 0
      ? { note: metadataNotes.trim() }
      : null;

  try {
    const normalizedPlatform = platform.trim().toLowerCase() as SocialPlatformType;
    const result = await validateSocialAccount({
      platform: normalizedPlatform,
      handle,
      customerProfileId: typeof customerProfileId === "string" && customerProfileId.length > 0 ? customerProfileId : null,
      manualMetrics: buildManualMetrics(formData),
      metadata,
    });
    return {
      status: "success",
      message: null,
      result,
    };
  } catch (error) {
    console.warn("Failed to validate social account", error);
    return {
      status: "error",
      message: "Unable to validate handle. Try again shortly.",
      result: null,
    };
  }
}
