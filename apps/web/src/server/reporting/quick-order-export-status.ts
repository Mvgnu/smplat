import "server-only";

import type { QuickOrderExportMetrics, QuickOrderExportStatus } from "@/types/reporting";

type QuickOrderExportStatusPayload = {
  syncedAt?: string | null;
  events?: number | null;
  downloadUrl?: string | null;
  workflowUrl?: string | null;
  metrics?: {
    startCount?: number | null;
    completeCount?: number | null;
    abortCount?: number | null;
    completionRate?: number | null;
  } | null;
};

const statusUrl = process.env.QUICK_ORDER_EXPORT_STATUS_URL ?? null;
const defaultWorkflowUrl =
  process.env.QUICK_ORDER_EXPORT_WORKFLOW_URL ??
  "https://github.com/smplat/smplat/actions/workflows/quick-order-telemetry-export.yml";

const coerceString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

function normalizeMetrics(payload: QuickOrderExportStatusPayload["metrics"]): QuickOrderExportMetrics | null {
  if (!payload) {
    return null;
  }
  const startCount = coerceNumber(payload.startCount);
  const completeCount = coerceNumber(payload.completeCount);
  const abortCount = coerceNumber(payload.abortCount);
  const completionRate = coerceNumber(payload.completionRate);
  if (startCount === null && completeCount === null && abortCount === null && completionRate === null) {
    return null;
  }
  return {
    startCount,
    completeCount,
    abortCount,
    completionRate,
  };
}

function normalizePayload(payload: QuickOrderExportStatusPayload | null): QuickOrderExportStatus | null {
  if (!payload) {
    return null;
  }
  const syncedAt = coerceString(payload.syncedAt);
  const events = coerceNumber(payload.events);
  const downloadUrl = coerceString(payload.downloadUrl);
  const workflowUrl = coerceString(payload.workflowUrl) ?? defaultWorkflowUrl;
  const metrics = normalizeMetrics(payload.metrics ?? null);

  if (!syncedAt && !events && !downloadUrl && !metrics) {
    return null;
  }

  return {
    syncedAt,
    events,
    downloadUrl,
    workflowUrl,
    metrics,
  };
}

export async function fetchQuickOrderExportStatus(): Promise<QuickOrderExportStatus | null> {
  if (!statusUrl) {
    return null;
  }
  try {
    const response = await fetch(statusUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Quick-order export status request failed (${response.status})`);
    }
    const payload = (await response.json()) as QuickOrderExportStatusPayload;
    return normalizePayload(payload);
  } catch (error) {
    console.warn("Unable to load quick-order export status", error);
    return null;
  }
}

