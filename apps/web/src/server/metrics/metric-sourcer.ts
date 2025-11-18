import "server-only";

import type { MetricValidationResult, SocialPlatformType } from "@/types/metrics";

export type ValidateSocialAccountParams = {
  platform: SocialPlatformType;
  handle: string;
  customerProfileId?: string | null;
  manualMetrics?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.startsWith("@")) {
    return trimmed.slice(1).trim();
  }
  return trimmed;
}

function sanitizeRecord(record: unknown): Record<string, unknown> {
  if (record && typeof record === "object" && !Array.isArray(record)) {
    return record as Record<string, unknown>;
  }
  return {};
}

function sanitizeValidationResult(payload: MetricValidationResult): MetricValidationResult {
  const account = {
    ...payload.account,
    metadata: sanitizeRecord(payload.account?.metadata),
    baselineMetrics: payload.account?.baselineMetrics && typeof payload.account.baselineMetrics === "object"
      ? (payload.account.baselineMetrics as Record<string, unknown>)
      : null,
    deliverySnapshots: payload.account?.deliverySnapshots && typeof payload.account.deliverySnapshots === "object"
      ? (payload.account.deliverySnapshots as Record<string, unknown>)
      : null,
    targetMetrics: payload.account?.targetMetrics && typeof payload.account.targetMetrics === "object"
      ? (payload.account.targetMetrics as Record<string, unknown>)
      : null,
  };
  const snapshot = {
    ...payload.snapshot,
    metrics: sanitizeRecord(payload.snapshot?.metrics),
    metadata: sanitizeRecord(payload.snapshot?.metadata),
    warnings: Array.isArray(payload.snapshot?.warnings) ? payload.snapshot.warnings : [],
  };

  return {
    account,
    snapshot,
    created: Boolean(payload.created),
  };
}

export async function validateSocialAccount(params: ValidateSocialAccountParams): Promise<MetricValidationResult> {
  const apiKey =
    process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
  if (!apiKey) {
    throw new Error("Metric validation requires CHECKOUT_API_KEY to be configured.");
  }

  const apiBaseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const normalizedHandle = normalizeHandle(params.handle);
  if (!normalizedHandle) {
    throw new Error("Account handle is required.");
  }

  const payload: Record<string, unknown> = {
    platform: params.platform,
    handle: normalizedHandle,
  };
  if (params.customerProfileId) {
    payload.customerProfileId = params.customerProfileId;
  }
  const manualMetrics = params.manualMetrics ?? null;
  if (manualMetrics && Object.keys(manualMetrics).length > 0) {
    payload.manualMetrics = manualMetrics;
  }
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    payload.metadata = params.metadata;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/metrics/accounts/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "Unknown error");
    throw new Error(`Metric validation failed (${response.status}): ${detail}`);
  }

  const result = (await response.json()) as MetricValidationResult;
  return sanitizeValidationResult(result);
}
