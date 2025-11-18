"use client";

import { useGuardrailWorkflowTelemetrySummary } from "@/lib/api/reporting";
import { WorkflowTelemetryInsight } from "./WorkflowTelemetryInsight";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

type AutomationWorkflowTelemetryProps = {
  initialTelemetry: GuardrailWorkflowTelemetrySummary | null;
  limit?: number;
  refreshIntervalMs?: number;
  className?: string;
};

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

export function AutomationWorkflowTelemetry({
  initialTelemetry,
  limit = 500,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  className,
}: AutomationWorkflowTelemetryProps) {
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
    revalidateOnMount: refreshIntervalMs > 0,
  });

  if (!data) {
    if (isLoading) {
      return <p className="text-xs text-white/60">Loading workflow telemetry…</p>;
    }
    if (error) {
      return <p className="text-xs text-rose-200">Unable to refresh workflow telemetry right now.</p>;
    }
    return <p className="text-xs text-white/60">Workflow telemetry will populate after the next automation run.</p>;
  }

  return (
    <div>
      {error ? <p className="text-xs text-rose-200">Latest refresh failed. Showing cached telemetry.</p> : null}
      {isValidating ? (
        <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Refreshing workflow telemetry…</p>
      ) : null}
      <WorkflowTelemetryInsight telemetry={data} className={className ?? "bg-black/20"} />
    </div>
  );
}
