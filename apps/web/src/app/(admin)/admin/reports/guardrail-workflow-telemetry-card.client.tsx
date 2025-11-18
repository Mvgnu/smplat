"use client";

import { useMemo } from "react";

import { useGuardrailWorkflowTelemetrySummary } from "@/lib/api/reporting";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

type GuardrailWorkflowTelemetryCardProps = {
  initialSummary: GuardrailWorkflowTelemetrySummary | null;
  limit?: number;
  refreshIntervalMs?: number;
};

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

export function GuardrailWorkflowTelemetryCard({
  initialSummary,
  limit = 500,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: GuardrailWorkflowTelemetryCardProps) {
  const {
    data: summary,
    error,
    isValidating,
    isLoading,
  } = useGuardrailWorkflowTelemetrySummary({
    limit,
    refreshIntervalMs,
    fallbackData: initialSummary ?? undefined,
    revalidateOnMount: refreshIntervalMs > 0,
  });
  const activeSummary = summary ?? null;
  const errorMessage = error ? "Unable to refresh guardrail workflow telemetry" : null;
  const headerBadge = useMemo(() => {
    if (isValidating) {
      return "Refreshing…";
    }
    if (error) {
      return "Stale";
    }
    if (!activeSummary?.lastCapturedAt) {
      return null;
    }
    return `Last captured ${formatTimestamp(activeSummary.lastCapturedAt)}`;
  }, [activeSummary, error, isValidating]);

  if (!activeSummary || activeSummary.totalEvents === 0) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Workflow telemetry</p>
          <h2 className="text-xl font-semibold text-white">Guardrail workflow board</h2>
          <p className="text-sm text-white/60">
            Attachment uploads, snippet copies, and inline follow-up logs will appear as soon as ops start using the workflow composer.
          </p>
        </div>
        {isLoading && !errorMessage ? <p className="mt-4 text-sm text-white/60">Loading telemetry…</p> : null}
        {errorMessage ? <p className="mt-4 text-sm text-red-300">{errorMessage}</p> : null}
      </section>
    );
  }

  const actionHighlights = activeSummary.actionCounts.slice(0, 3);
  const attachmentTotals = activeSummary.attachmentTotals;

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Workflow telemetry</p>
          <h2 className="text-xl font-semibold text-white">Guardrail composer activity</h2>
          <p className="text-sm text-white/60">
            Snapshot of the last {activeSummary.totalEvents} workflow actions. Use this to monitor Slack snippet usage, attachment uploads,
            and provider follow-up volume without leaving the dashboard.
          </p>
        </div>
        {headerBadge ? (
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">{headerBadge}</span>
        ) : null}
      </header>
      {errorMessage ? <p className="text-sm text-red-300">Latest refresh failed. Showing cached telemetry.</p> : null}
      <dl className="grid gap-4 text-sm text-white/80 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Attachment activity</dt>
          <dd className="mt-2 space-y-1 text-sm text-white/70">
            <p>
              Uploads · <span className="font-semibold text-white">{attachmentTotals.upload}</span>
            </p>
            <p>
              Removals · <span className="font-semibold text-white">{attachmentTotals.remove}</span>
            </p>
            <p>
              Copies · <span className="font-semibold text-white">{attachmentTotals.copy}</span>
            </p>
            <p>
              Tagged history · <span className="font-semibold text-white">{attachmentTotals.tag}</span>
            </p>
          </dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Top actions</dt>
          <dd className="mt-2 space-y-1 text-sm text-white/70">
            {actionHighlights.length === 0 ? (
              <p>No workflow actions recorded.</p>
            ) : (
              actionHighlights.map((action) => (
                <p key={action.action} className={isValidating ? "flex items-center justify-between gap-2 opacity-80" : "flex items-center justify-between gap-2"}>
                  <span className="uppercase tracking-[0.2em] text-white/50">{action.action}</span>
                  <span className="font-semibold text-white">{action.count}</span>
                </p>
              ))
            )}
          </dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Provider highlights</dt>
          <dd className="mt-2 space-y-2 text-sm text-white/70">
            {activeSummary.providerActivity.length === 0 ? (
              <p>No providers recorded.</p>
            ) : (
              activeSummary.providerActivity.map((provider) => (
                <div key={`${provider.providerId ?? provider.providerName}-workflow`} className="space-y-0.5">
                  <p className="font-semibold text-white">{provider.providerName ?? provider.providerId ?? "Unknown provider"}</p>
                  <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
                    {provider.lastAction} · {provider.totalActions} actions · {formatTimestamp(provider.lastActionAt ?? null)}
                  </p>
                </div>
              ))
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
