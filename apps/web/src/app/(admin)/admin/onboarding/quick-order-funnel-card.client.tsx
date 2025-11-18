"use client";

import { useEffect, useMemo, useState } from "react";

import type { QuickOrderExportStatus, QuickOrderFunnelMetrics, GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";

export type QuickOrderFunnelView = "local" | "export";

type QuickOrderFunnelCardProps = {
  funnel: QuickOrderFunnelMetrics | null;
  exportStatus?: QuickOrderExportStatus | null;
  defaultView?: QuickOrderFunnelView;
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

export function QuickOrderFunnelCard({
  funnel,
  exportStatus = null,
  defaultView = "local",
  workflowTelemetry = null,
}: QuickOrderFunnelCardProps) {
  const [preferredView, setPreferredView] = useState<QuickOrderFunnelView>(defaultView);
  useEffect(() => {
    setPreferredView(defaultView);
  }, [defaultView]);

  const hasLocalTelemetry = Boolean(funnel);
  const exportMetrics = exportStatus?.metrics ?? null;
  const hasExportSnapshot = Boolean(exportMetrics || exportStatus?.syncedAt || exportStatus?.downloadUrl);
  const activeView = useMemo(() => {
    if (preferredView === "local" && hasLocalTelemetry) {
      return "local";
    }
    if (preferredView === "export" && hasExportSnapshot) {
      return "export";
    }
    if (hasLocalTelemetry) {
      return "local";
    }
    if (hasExportSnapshot) {
      return "export";
    }
    return "local";
  }, [preferredView, hasLocalTelemetry, hasExportSnapshot]);

  const metrics: MetricComparisonEntry[] = [
    {
      label: "Starts",
      suffix: "",
      local: funnel?.startCount ?? null,
      external: exportMetrics?.startCount ?? null,
    },
    {
      label: "Completes",
      suffix: "",
      local: funnel?.completeCount ?? null,
      external: exportMetrics?.completeCount ?? null,
    },
    {
      label: "Aborts",
      suffix: "",
      local: funnel?.abortCount ?? null,
      external: exportMetrics?.abortCount ?? null,
    },
    {
      label: "Completion rate",
      suffix: "%",
      local: funnel?.completionRate ?? null,
      external: exportMetrics?.completionRate ?? null,
    },
  ];
  const deltaValues = metrics
    .map((metric) => computeDelta(metric.local, metric.external))
    .filter((value): value is number => value !== null);
  const maxDeltaMagnitude = deltaValues.length > 0 ? Math.max(...deltaValues.map((value) => Math.abs(value))) : 0;

  const lastEventLabel = formatDateTime(funnel?.lastEventAt ?? null);
  const exportSyncedLabel = formatDateTime(exportStatus?.syncedAt ?? null);
  const remoteDownloadHref = exportStatus?.downloadUrl ? "/api/reporting/quick-order-export" : null;
  const deltaSummary =
    hasLocalTelemetry && hasExportSnapshot
      ? buildDeltaSummary(metrics)
      : "Compare local telemetry against the Snowflake export snapshot to confirm ingestion parity.";
  const telemetryBanner = (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
      <QuickOrderWorkflowTelemetry initialTelemetry={workflowTelemetry ?? null} testId="workflow-telemetry-onboarding-card" />
    </div>
  );
  const header = (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Quick-order funnel</p>
        <h3 className="text-lg font-semibold text-white">Storefront vs Snowflake snapshot</h3>
        <p className="text-sm text-white/60">{deltaSummary}</p>
      </div>
      <div className="text-right text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
        {hasLocalTelemetry ? <p>Local last event {lastEventLabel}</p> : null}
        {hasExportSnapshot ? <p>Export synced {exportSyncedLabel}</p> : null}
      </div>
    </header>
  );

  if (!hasLocalTelemetry && !hasExportSnapshot) {
    return (
      <article className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-6">
        {header}
        {telemetryBanner}
        <p className="text-sm text-white/60">
          No quick-order telemetry captured yet. Once storefront sessions emit `quick_order.*` events—or the export workflow runs—you will
          see both the local funnel and Snowflake snapshot here. Guardrail workflow telemetry above continues to refresh so Ops can still
          inspect the shared cache.
        </p>
      </article>
    );
  }

  return (
    <article className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-6">
      {header}
      {telemetryBanner}

      {hasLocalTelemetry && hasExportSnapshot ? (
        <div className="inline-flex rounded-full border border-white/20 bg-black/20 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
          <button
            type="button"
            onClick={() => setPreferredView("local")}
            className={`rounded-full px-3 py-1 transition ${
              activeView === "local"
                ? "bg-white/90 text-black shadow"
                : "text-white/60 hover:text-white"
            }`}
          >
            Local telemetry
          </button>
          <button
            type="button"
            onClick={() => setPreferredView("export")}
            className={`rounded-full px-3 py-1 transition ${
              activeView === "export"
                ? "bg-white/90 text-black shadow"
                : "text-white/60 hover:text-white"
            }`}
          >
            Snowflake export
          </button>
        </div>
      ) : null}

      <dl className="grid gap-4 text-sm text-white/80 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <MetricComparisonRow
            key={metric.label}
            entry={metric}
            activeSource={activeView}
            exportAvailable={hasExportSnapshot}
            deltaMax={maxDeltaMagnitude}
          />
        ))}
      </dl>

      {hasLocalTelemetry ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Abort reasons</p>
            {funnel?.abortReasons.length === 0 ? (
              <p className="mt-2 text-sm text-white/60">No abort telemetry recorded.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-white/80">
                {funnel.abortReasons.slice(0, 5).map((entry) => (
                  <li key={entry.reason} className="flex items-center justify-between">
                    <span className="truncate">{entry.reason.replace(/_/g, " ")}</span>
                    <span className="font-mono text-xs text-white/60">{entry.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Weekly flow</p>
            {funnel?.dailySeries.length === 0 ? (
              <p className="mt-2 text-sm text-white/60">Recent telemetry not available.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-white/80">
                {funnel.dailySeries.slice(-7).map((entry) => (
                  <li key={entry.date} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white/60">{entry.date}</span>
                    <span className="text-white/80">
                      {entry.starts} start{entry.starts === 1 ? "" : "s"} · {entry.completes} complete
                      {entry.completes === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {hasExportSnapshot ? (
        <section className="space-y-3 rounded-2xl border border-dashed border-white/15 bg-black/25 p-4 text-sm text-white/70">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-white/40">
            <p>Snowflake export snapshot</p>
            {exportStatus?.events ? <p>Events mirrored {exportStatus.events}</p> : null}
          </div>
          <p>
            Export workflow mirrors the `.telemetry/quick-order-events.ndjson` retention window into Snowflake/S3 every 30 minutes. Use these
            controls to spot-check parity or pull the source file for downstream ingestion.
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white">
            <a
              href="/api/telemetry/quick-order/export"
              className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white transition hover:border-white/60 hover:text-white"
            >
              Download local NDJSON
            </a>
            {remoteDownloadHref ? (
              <a
                href={remoteDownloadHref}
                className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white/80 transition hover:border-white/60 hover:text-white"
              >
                Download export NDJSON
              </a>
            ) : (
              <span className="inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-white/40">
                Export download unavailable
              </span>
            )}
            {exportStatus?.workflowUrl ? (
              <a
                href={exportStatus.workflowUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white/70 transition hover:border-white/60 hover:text-white"
              >
                View workflow
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
    </article>
  );
}

type MetricComparisonEntry = {
  label: string;
  suffix: string;
  local: number | null;
  external: number | null;
};

type MetricComparisonRowProps = {
  entry: MetricComparisonEntry;
  activeSource: QuickOrderFunnelView;
  exportAvailable: boolean;
  deltaMax: number;
};

function MetricComparisonRow({ entry, activeSource, exportAvailable, deltaMax }: MetricComparisonRowProps) {
  const primaryLabel = activeSource === "local" ? "Local telemetry" : "Snowflake export";
  const secondaryLabel = activeSource === "local" ? "Snowflake export" : "Local telemetry";
  const primaryValue = activeSource === "local" ? entry.local : entry.external;
  const secondaryValue = activeSource === "local" ? entry.external : entry.local;
  const formattedPrimary = formatMetricValue(primaryValue, entry.suffix);
  const formattedSecondary = formatMetricValue(secondaryValue, entry.suffix);
  const delta = computeDelta(entry.local, entry.external);
  const deltaLabel =
    delta !== null
      ? `${delta > 0 ? "+" : ""}${entry.suffix === "%" ? delta.toFixed(0) : delta.toLocaleString()}${entry.suffix}`
      : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{entry.label}</dt>
      <dd className="space-y-2 text-sm text-white">
        <p className="text-base font-semibold text-white">
          {primaryLabel}: {formattedPrimary}
        </p>
        {exportAvailable ? (
          <p className="text-[0.7rem] uppercase tracking-[0.2em] text-white/60">
            {secondaryLabel}: {secondaryValue !== null ? formattedSecondary : "Pending"}
            {deltaLabel ? (
              <span className={`ml-2 font-semibold ${delta > 0 ? "text-emerald-300" : delta < 0 ? "text-amber-300" : "text-white/60"}`}>
                {deltaLabel}
              </span>
            ) : null}
          </p>
        ) : null}
        {delta !== null && deltaMax > 0 ? <DeltaSparkline delta={delta} maxMagnitude={deltaMax} /> : null}
      </dd>
    </div>
  );
}

type DeltaSparklineProps = {
  delta: number;
  maxMagnitude: number;
};

function DeltaSparkline({ delta, maxMagnitude }: DeltaSparklineProps) {
  const extent = maxMagnitude === 0 ? 0 : Math.min(Math.abs(delta) / maxMagnitude, 1);
  const widthPercentage = `${(extent * 50).toFixed(2)}%`;
  const isPositive = delta >= 0;
  return (
    <div className="space-y-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
        <span className="absolute left-1/2 top-0 h-full w-px bg-white/25" />
        <span
          className={`absolute top-0 h-full ${isPositive ? "bg-emerald-400/70" : "bg-amber-400/80"}`}
          style={{
            width: widthPercentage,
            left: isPositive ? "50%" : `calc(50% - ${widthPercentage})`,
          }}
        />
      </div>
      <p>Δ {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
    </div>
  );
}

function computeDelta(localValue: number | null, externalValue: number | null): number | null {
  if (
    localValue === null ||
    externalValue === null ||
    !Number.isFinite(localValue) ||
    !Number.isFinite(externalValue)
  ) {
    return null;
  }
  return externalValue - localValue;
}

function formatMetricValue(value: number | null, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  const formatted = suffix === "%" ? value.toFixed(0) : value.toLocaleString();
  return `${formatted}${suffix}`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function buildDeltaSummary(metrics: MetricComparisonEntry[]): string {
  const rows = metrics
    .map((metric) => {
      const delta = computeDelta(metric.local, metric.external);
      if (delta === null || delta === 0) {
        return null;
      }
      const formatted =
        metric.suffix === "%"
          ? delta.toFixed(0)
          : delta.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return `${metric.label}: ${delta > 0 ? "+" : ""}${formatted}${metric.suffix}`;
    })
    .filter((value): value is string => Boolean(value));
  return rows.length > 0
    ? `Delta sparkline highlights Snowflake drift (${rows.join(" · ")}).`
    : "Snowflake export matches the local telemetry snapshot.";
}
