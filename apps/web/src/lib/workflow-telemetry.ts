import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

export function extractWorkflowTelemetrySummary(source: unknown): GuardrailWorkflowTelemetrySummary | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const container = source as Record<string, unknown>;
  const payload = (container.workflowTelemetry ?? container) as Record<string, unknown>;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const totalEvents = typeof payload.totalEvents === "number" ? payload.totalEvents : null;
  if (totalEvents === null) {
    return null;
  }
  const lastCapturedAt =
    typeof payload.lastCapturedAt === "string" && payload.lastCapturedAt.length > 0 ? payload.lastCapturedAt : null;
  const attachmentTotals = normalizeAttachmentTotals(payload.attachmentTotals);
  const actionCounts = normalizeActionCounts(payload.actionCounts);
  const providerActivity = normalizeProviderActivity(payload.providerActivity);
  return {
    totalEvents,
    lastCapturedAt,
    actionCounts,
    attachmentTotals,
    providerActivity,
  };
}

function normalizeAttachmentTotals(value: unknown): GuardrailWorkflowTelemetrySummary["attachmentTotals"] {
  const source = (value as Record<string, unknown>) ?? {};
  const coerce = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : 0);
  return {
    upload: coerce(source.upload),
    remove: coerce(source.remove),
    copy: coerce(source.copy),
    tag: coerce(source.tag),
  };
}

function normalizeActionCounts(value: unknown): GuardrailWorkflowTelemetrySummary["actionCounts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const data = entry as Record<string, unknown>;
      const action = typeof data.action === "string" ? data.action : null;
      const count = typeof data.count === "number" ? data.count : null;
      const lastOccurredAt =
        typeof data.lastOccurredAt === "string" && data.lastOccurredAt.length > 0 ? data.lastOccurredAt : null;
      if (!action || count === null) {
        return null;
      }
      return { action, count, lastOccurredAt };
    })
    .filter(Boolean) as GuardrailWorkflowTelemetrySummary["actionCounts"];
}

function normalizeProviderActivity(value: unknown): GuardrailWorkflowTelemetrySummary["providerActivity"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const data = entry as Record<string, unknown>;
      const providerId = typeof data.providerId === "string" ? data.providerId : null;
      const providerName = typeof data.providerName === "string" ? data.providerName : null;
      const lastAction = typeof data.lastAction === "string" ? data.lastAction : "unknown";
      const lastActionAt =
        typeof data.lastActionAt === "string" && data.lastActionAt.length > 0 ? data.lastActionAt : null;
      const totalActions = typeof data.totalActions === "number" ? data.totalActions : 0;
      return { providerId, providerName, lastAction, lastActionAt, totalActions };
    })
    .filter(Boolean) as GuardrailWorkflowTelemetrySummary["providerActivity"];
}
