"use server";

import { revalidatePath } from "next/cache";

import {
  triggerProviderAutomationAlertRun,
  triggerProviderAutomationReplayRun,
} from "@/server/fulfillment/provider-automation-insights";

async function extractLimit(formData: FormData): Promise<number | undefined> {
  const value = formData.get("limit");
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractPath(formData: FormData, fallback: string): string {
  const path = formData.get("path");
  return typeof path === "string" && path ? path : fallback;
}

export async function runAutomationReplayAction(formData: FormData) {
  const limit = await extractLimit(formData);
  const path = extractPath(formData, "/admin/orders");
  await triggerProviderAutomationReplayRun(limit);
  revalidatePath(path);
}

export async function runAutomationAlertAction(formData: FormData) {
  const path = extractPath(formData, "/admin/orders");
  await triggerProviderAutomationAlertRun();
  revalidatePath(path);
}
