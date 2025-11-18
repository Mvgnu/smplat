import "server-only";

import { readGuardrailWorkflowEvents } from "@/server/telemetry/guardrail-workflow-storage";
import type { GuardrailWorkflowTelemetryEvent, GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

const DEFAULT_LIMIT = 500;
const MIN_CACHE_TTL_MS = 5_000;
const SUMMARY_CACHE_TTL_MS = Math.max(
  Number(process.env.GUARDRAIL_WORKFLOW_SUMMARY_CACHE_TTL_MS ?? 30_000),
  MIN_CACHE_TTL_MS,
);

type SummaryCacheEntry = {
  expiresAt: number;
  summary: GuardrailWorkflowTelemetrySummary;
};

const summaryCache = new Map<number, SummaryCacheEntry>();

type FetchGuardrailWorkflowTelemetrySummaryOptions = {
  useCache?: boolean;
};

export function clearGuardrailWorkflowTelemetrySummaryCache() {
  summaryCache.clear();
}

export async function fetchGuardrailWorkflowTelemetrySummary(
  limit = DEFAULT_LIMIT,
  options: FetchGuardrailWorkflowTelemetrySummaryOptions = {},
): Promise<GuardrailWorkflowTelemetrySummary> {
  const cacheKey = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const useCache = options.useCache ?? true;

  if (useCache) {
    const cached = summaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.summary);
    }
  }

  const events = await readGuardrailWorkflowEvents(cacheKey);
  if (!events.length) {
    return {
      totalEvents: 0,
      lastCapturedAt: null,
      actionCounts: [],
      attachmentTotals: { upload: 0, remove: 0, copy: 0, tag: 0 },
      providerActivity: [],
    };
  }

  const actionMap = new Map<string, { count: number; lastOccurredAt: string | null }>();
  const providerMap = new Map<
    string,
    { providerId: string | null; providerName: string | null; lastAction: string; lastActionAt: string | null; totalActions: number }
  >();
  const attachmentTotals = { upload: 0, remove: 0, copy: 0, tag: 0 };
  let lastCapturedAt: string | null = null;

  for (const event of events) {
    const timestamp = event.recordedAt ?? null;
    if (!lastCapturedAt || (timestamp && timestamp > lastCapturedAt)) {
      lastCapturedAt = timestamp;
    }
    const entry = actionMap.get(event.workflowAction) ?? { count: 0, lastOccurredAt: null };
    entry.count += 1;
    if (!entry.lastOccurredAt || (timestamp && timestamp > entry.lastOccurredAt)) {
      entry.lastOccurredAt = timestamp;
    }
    actionMap.set(event.workflowAction, entry);

    const providerKey = event.providerId ?? `unknown-${event.providerName ?? "n/a"}`;
    const providerEntry =
      providerMap.get(providerKey) ?? {
        providerId: event.providerId ?? null,
        providerName: event.providerName ?? null,
        lastAction: event.workflowAction,
        lastActionAt: timestamp,
        totalActions: 0,
      };
    providerEntry.totalActions += 1;
    if (!providerEntry.lastActionAt || (timestamp && timestamp > providerEntry.lastActionAt)) {
      providerEntry.lastActionAt = timestamp;
      providerEntry.lastAction = event.workflowAction;
    }
    providerMap.set(providerKey, providerEntry);

    if (event.workflowAction.startsWith("attachment.")) {
      if (event.workflowAction === "attachment.upload") {
        attachmentTotals.upload += 1;
      } else if (event.workflowAction === "attachment.remove") {
        attachmentTotals.remove += 1;
      } else if (event.workflowAction === "attachment.copy") {
        attachmentTotals.copy += 1;
      } else if (event.workflowAction === "attachment.tag") {
        attachmentTotals.tag += 1;
      }
    }
  }

  const actionCounts = Array.from(actionMap.entries())
    .map(([action, info]) => ({ action, count: info.count, lastOccurredAt: info.lastOccurredAt }))
    .sort((a, b) => b.count - a.count);
  const providerActivity = Array.from(providerMap.values())
    .sort((a, b) => {
      if (a.lastActionAt && b.lastActionAt) {
        return b.lastActionAt.localeCompare(a.lastActionAt);
      }
      if (a.lastActionAt) {
        return -1;
      }
      if (b.lastActionAt) {
        return 1;
      }
      return b.totalActions - a.totalActions;
    })
    .slice(0, 5);

  const summary: GuardrailWorkflowTelemetrySummary = {
    totalEvents: events.length,
    lastCapturedAt,
    actionCounts,
    attachmentTotals,
    providerActivity,
  };

  if (useCache) {
    summaryCache.set(cacheKey, {
      expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
      summary: structuredClone(summary),
    });
  }

  return summary;
}
