"use client";

import { formatTimestamp } from "@/lib/format-timestamp";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

type WorkflowTelemetryInsightProps = {
  telemetry: GuardrailWorkflowTelemetrySummary;
  className?: string;
};

export function WorkflowTelemetryInsight({ telemetry, className }: WorkflowTelemetryInsightProps) {
  const topAction = telemetry.actionCounts[0];
  const attachments = telemetry.attachmentTotals;

  return (
    <div className={["mt-3 rounded-2xl border border-white/10 bg-black/10 p-3", className].filter(Boolean).join(" ")}>
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
      <p className="mt-1 text-sm text-white/80">
        {telemetry.totalEvents} actions
        {telemetry.lastCapturedAt ? (
          <>
            {" · "}Last capture <span className="text-white">{formatTimestamp(telemetry.lastCapturedAt)}</span>
          </>
        ) : null}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
        <span>Uploads {attachments.upload}</span>
        <span>Removals {attachments.remove}</span>
        <span>Copies {attachments.copy}</span>
        <span>Tagged {attachments.tag}</span>
      </div>
      {topAction ? (
        <p className="mt-1 text-xs text-white/60">
          Top action:{" "}
          <span className="font-semibold text-white">
            {topAction.action} ({topAction.count})
          </span>
        </p>
      ) : null}
    </div>
  );
}
