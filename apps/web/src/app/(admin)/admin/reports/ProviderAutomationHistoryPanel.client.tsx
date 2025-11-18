"use client";

import { useMemo } from "react";

import { AutoGuardrailActionChip } from "@/components/admin/AutoGuardrailActionChip";
import { WorkflowTelemetryInsight } from "@/components/admin/WorkflowTelemetryInsight";
import { useGuardrailWorkflowTelemetrySummary } from "@/lib/api/reporting";
import { collectAutoGuardrailActions, type ProviderAutoAction } from "@/lib/automation-actions";
import { formatTimestamp } from "@/lib/format-timestamp";
import { extractWorkflowTelemetrySummary } from "@/lib/workflow-telemetry";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import type { ProviderAutomationHistory, ProviderAutomationRunStatus } from "@/types/provider-automation";
import { extractSummaryNumber } from "./summary-helpers";

type ProviderAutomationHistoryPanelProps = {
  history: ProviderAutomationHistory;
  initialWorkflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
  telemetryHook?: typeof useGuardrailWorkflowTelemetrySummary;
};

type ProviderAutomationHistoryEntry = ProviderAutomationRunStatus & { kind: "alerts" | "replay" };

export function ProviderAutomationHistoryPanel({
  history,
  initialWorkflowTelemetry,
  telemetryHook,
}: ProviderAutomationHistoryPanelProps) {
  const entries = useMemo<ProviderAutomationHistoryEntry[]>(() => {
    return [
      ...history.alerts.map((entry) => ({ ...entry, kind: "alerts" as const })),
      ...history.replay.map((entry) => ({ ...entry, kind: "replay" as const })),
    ]
      .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())
      .slice(0, 8);
  }, [history]);

  const useTelemetrySummary = telemetryHook ?? useGuardrailWorkflowTelemetrySummary;
  const {
    data: workflowTelemetry,
    error: workflowTelemetryError,
    isLoading: workflowTelemetryLoading,
  } = useTelemetrySummary({
    limit: 500,
    refreshIntervalMs: 60_000,
    fallbackData: initialWorkflowTelemetry ?? undefined,
  });

  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Automation runs</p>
          <h2 className="text-xl font-semibold text-white">Replay + alert history</h2>
          <p className="text-sm text-white/60">Latest invocations of provider replay + alert workers with summary stats.</p>
        </div>
      </header>
      <WorkflowTelemetrySummaryBanner
        telemetry={workflowTelemetry ?? null}
        isLoading={workflowTelemetryLoading}
        error={workflowTelemetryError}
      />
      <ul className="mt-4 space-y-3">
        {entries.map((entry, index) => {
          const autoActions = entry.kind === "alerts" ? resolveAutoGuardrailActions(entry) : [];
          const entryTelemetry =
            entry.kind === "alerts"
              ? extractWorkflowTelemetrySummary(entry.metadata ?? entry.summary ?? null)
              : null;
          return (
            <li key={`${entry.kind}-${entry.ranAt}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/50">
                <span>{entry.kind === "alerts" ? "Alert worker" : "Replay worker"}</span>
                <span>{formatTimestamp(entry.ranAt)}</span>
              </div>
              <p className="mt-2 text-sm text-white/80">{describeRunSummary(entry.summary, entry.kind, autoActions)}</p>
              {entry.kind === "alerts" ? <AutoGuardrailActionList entry={entry} actions={autoActions} /> : null}
              {entryTelemetry ? <WorkflowTelemetryInsight telemetry={entryTelemetry} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WorkflowTelemetrySummaryBanner({
  telemetry,
  isLoading,
  error,
}: {
  telemetry: GuardrailWorkflowTelemetrySummary | null;
  isLoading: boolean;
  error?: Error;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Live workflow telemetry</p>
      {telemetry ? (
        <WorkflowTelemetryInsight telemetry={telemetry} className="mt-2 border-white/10 bg-black/40" />
      ) : error ? (
        <p className="mt-2 text-sm text-rose-200">Unable to load guardrail workflow telemetry.</p>
      ) : isLoading ? (
        <p className="mt-2 text-sm text-white/60">Loading guardrail workflow telemetry…</p>
      ) : (
        <p className="mt-2 text-sm text-white/60">Telemetry has not been captured yet.</p>
      )}
    </div>
  );
}

function AutoGuardrailActionList({
  entry,
  actions,
}: {
  entry: ProviderAutomationHistoryEntry;
  actions: ProviderAutoAction[];
}) {
  if (!actions.length) {
    return null;
  }

  return (
    <div className="mt-3">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Auto guardrail actions</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.slice(0, 6).map((action, idx) => (
          <AutoGuardrailActionChip
            key={`${entry.kind}-${entry.ranAt}-${action.followUpId ?? `${action.providerId}-${idx}`}-${action.action}`}
            action={action}
          />
        ))}
      </div>
    </div>
  );
}

function describeRunSummary(
  summary: Record<string, unknown> | undefined,
  kind: "alerts" | "replay",
  autoActions: ProviderAutoAction[] = [],
): string {
  if (!summary || typeof summary !== "object") {
    return kind === "alerts" ? "No alerts dispatched." : "No replays recorded.";
  }
  if (kind === "alerts") {
    const alertsSent = extractSummaryNumber(summary, "alertsSent");
    const loadAlerts = extractSummaryNumber(summary, "loadAlerts");
    const autoPaused = extractSummaryNumber(summary, "autoPaused");
    const autoResumed = extractSummaryNumber(summary, "autoResumed");
    const pausedNames = autoActions
      .filter((action) => action.action === "pause")
      .map((action) => action.providerName)
      .slice(0, 2);
    const resumedNames = autoActions
      .filter((action) => action.action === "resume")
      .map((action) => action.providerName)
      .slice(0, 2);
    const chunks = [`Alerts sent: ${alertsSent}`, `Load alerts: ${loadAlerts}`];
    if (autoPaused > 0) {
      const label =
        pausedNames.length > 0
          ? `${pausedNames.join(", ")}${autoPaused > pausedNames.length ? " +" : ""}`
          : null;
      chunks.push(`Auto-paused: ${autoPaused}${label ? ` (${label})` : ""}`);
    }
    if (autoResumed > 0) {
      const label =
        resumedNames.length > 0
          ? `${resumedNames.join(", ")}${autoResumed > resumedNames.length ? " +" : ""}`
          : null;
      chunks.push(`Auto-resumed: ${autoResumed}${label ? ` (${label})` : ""}`);
    }
    return chunks.join(" · ");
  }
  const processed = extractSummaryNumber(summary, "processed");
  const succeeded = extractSummaryNumber(summary, "succeeded");
  const failed = extractSummaryNumber(summary, "failed");
  return `Replays processed: ${processed} · Success: ${succeeded} · Failed: ${failed}`;
}

function resolveAutoGuardrailActions(entry: ProviderAutomationHistoryEntry): ProviderAutoAction[] {
  if (!entry) {
    return [];
  }
  if (entry.metadata && typeof entry.metadata === "object") {
    const metadataEntry = {
      ranAt: entry.ranAt,
      summary: entry.metadata,
      metadata: entry.metadata,
    } as ProviderAutomationRunStatus;
    const metadataActions = collectAutoGuardrailActions(metadataEntry);
    if (metadataActions.length > 0) {
      return metadataActions;
    }
  }
  return collectAutoGuardrailActions(entry);
}
