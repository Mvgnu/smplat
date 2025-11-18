"use client";

import { useMemo } from "react";

import { useGuardrailWorkflowTelemetrySummary } from "@/lib/api/reporting";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

type QuickOrderWorkflowTelemetryProps = {
  initialTelemetry: GuardrailWorkflowTelemetrySummary | null;
  limit?: number;
  refreshIntervalMs?: number;
  testId?: string;
};

const DEFAULT_REFRESH_INTERVAL_MS = 120_000;

export function QuickOrderWorkflowTelemetry({
  initialTelemetry,
  limit = 500,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  testId,
}: QuickOrderWorkflowTelemetryProps) {
  const {
    data,
    error,
    isValidating,
    isLoading,
  } = useGuardrailWorkflowTelemetrySummary({
    limit,
    refreshIntervalMs,
    fallbackData: initialTelemetry ?? undefined,
    revalidateOnFocus: true,
    revalidateOnMount: true,
  });
  const telemetry = data ?? null;
  const topAction = telemetry?.actionCounts?.[0] ?? null;
  const lastCapturedLabel = telemetry?.lastCapturedAt ? formatTimestamp(telemetry.lastCapturedAt) : null;

  const statusLabel = useMemo(() => {
    if (isValidating) {
      return "Refreshing workflow telemetry…";
    }
    if (error) {
      return "Workflow telemetry is temporarily stale.";
    }
    if (telemetry?.totalEvents) {
      return `Last capture ${lastCapturedLabel ?? "recently"}`;
    }
    return null;
  }, [error, isValidating, telemetry?.totalEvents, lastCapturedLabel]);

  if (!telemetry) {
    if (isLoading) {
      return (
        <div data-testid={testId}>
          <p className="text-xs text-white/60">Loading workflow telemetry…</p>
        </div>
      );
    }
    return (
      <div data-testid={testId}>
        <p className="text-xs text-white/60">
          Workflow telemetry (attachment uploads, snippet copies) will appear once automation captures activity for this account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm text-white/70" data-testid={testId}>
      <p>
        <span className="font-semibold text-white">{telemetry.totalEvents}</span> actions captured
        {statusLabel ? (
          <span className="ml-2 text-xs uppercase tracking-[0.2em] text-white/50">{statusLabel}</span>
        ) : null}
      </p>
      <p className="text-xs text-white/60">
        Attachments — upload {telemetry.attachmentTotals.upload}, remove {telemetry.attachmentTotals.remove}, copy{" "}
        {telemetry.attachmentTotals.copy}, tag {telemetry.attachmentTotals.tag}
      </p>
      {topAction ? (
        <p className="text-xs text-white/60">
          Top action: {topAction.action} ({topAction.count})
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-200">Unable to refresh telemetry right now.</p> : null}
    </div>
  );
}
