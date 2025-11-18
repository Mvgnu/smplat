import type { ProviderAutomationRunStatus } from "@/types/provider-automation";

export type ProviderAutoAction = {
  providerId: string;
  providerName: string;
  action: "pause" | "resume";
  reasons?: string[];
  notes?: string;
  followUpId?: string;
  ranAt?: string | null;
  automationHref?: string | null;
};

export function collectAutoGuardrailActions(entry: ProviderAutomationRunStatus | null | undefined): ProviderAutoAction[] {
  if (!entry) {
    return [];
  }
  const metadata = (entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null) as
    | Record<string, unknown>
    | null;
  const summary = (entry.summary && typeof entry.summary === "object" ? entry.summary : null) as Record<string, unknown> | null;
  const actions: ProviderAutoAction[] = [];
  actions.push(...normalizeAutoActionList(metadata?.["autoPausedProviders"] ?? summary?.["autoPausedProviders"], "pause", entry.ranAt));
  actions.push(
    ...normalizeAutoActionList(metadata?.["autoResumedProviders"] ?? summary?.["autoResumedProviders"], "resume", entry.ranAt),
  );
  return actions;
}

function normalizeAutoActionList(
  value: unknown,
  action: ProviderAutoAction["action"],
  ranAt?: string | null,
): ProviderAutoAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const sourceProviderId = coerceString(record.providerId);
      const providerName = coerceString(record.providerName) ?? sourceProviderId ?? "Provider";
      if (!providerName) {
        return null;
      }
      const reasons = Array.isArray(record.reasons)
        ? record.reasons.map((reason) => String(reason)).filter(Boolean)
        : undefined;
      const notes = coerceString(record.notes) ?? undefined;
      const followUpId = coerceString(record.followUpId) ?? undefined;
      return {
        providerId: sourceProviderId ?? providerName,
        providerName,
        action,
        reasons,
        notes,
        followUpId,
        ranAt: ranAt ?? coerceString(record.ranAt),
        automationHref: sourceProviderId ? `/admin/fulfillment/providers/${sourceProviderId}?tab=automation` : null,
      };
    })
    .filter((entry): entry is ProviderAutoAction => Boolean(entry));
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

export function buildAutoActionTooltip(action: ProviderAutoAction): string | undefined {
  const parts: string[] = [];
  const reasonLabel = action.reasons && action.reasons.length > 0 ? action.reasons.join(", ") : null;
  if (reasonLabel) {
    parts.push(reasonLabel);
  }
  if (action.notes) {
    parts.push(action.notes);
  }
  if (action.ranAt) {
    const parsed = new Date(action.ranAt);
    const formatted = Number.isNaN(parsed.valueOf()) ? action.ranAt : parsed.toLocaleString();
    parts.push(`Run: ${formatted}`);
  }
  return parts.length ? parts.join(" • ") : undefined;
}
