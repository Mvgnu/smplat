import Link from "next/link";

import { AutoGuardrailActionChip } from "@/components/admin/AutoGuardrailActionChip";
import type {
  ExperimentConversionMetric,
  ExperimentTrendSeries,
  VariantStatusBreakdown,
  QuickOrderFunnelMetrics,
  QuickOrderExportStatus,
  GuardrailWorkflowTelemetrySummary
} from "@/types/reporting";
import type { ProviderAutoAction } from "@/lib/automation-actions";
import { ExperimentConversionCardClient } from "./experiment-conversions.client";
import { QuickOrderFunnelCard, type QuickOrderFunnelView } from "./quick-order-funnel-card.client";

type ExperimentAnalyticsPanelProps = {
  trendSeries: ExperimentTrendSeries[];
  variantBreakdown: VariantStatusBreakdown[];
  conversionMetrics?: ExperimentConversionMetric[];
  conversionCursor?: string | null;
  conversionRequestCursor?: string | null;
  quickOrderFunnel?: QuickOrderFunnelMetrics | null;
  quickOrderExportStatus?: QuickOrderExportStatus | null;
  quickOrderFunnelDefaultView?: QuickOrderFunnelView;
  guardrailWorkflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
  autoActions?: ProviderAutoAction[];
  autoActionsRunAt?: string | null;
  clearCursorAction?: (formData: FormData) => Promise<void>;
  clearCursorHref?: string | null;
};

export function ExperimentAnalyticsPanel({
  trendSeries,
  variantBreakdown,
  conversionMetrics = [],
  conversionCursor = null,
  conversionRequestCursor = null,
  quickOrderFunnel = null,
  quickOrderExportStatus = null,
  quickOrderFunnelDefaultView = "local",
  guardrailWorkflowTelemetry = null,
  autoActions = [],
  autoActionsRunAt = null,
  clearCursorAction,
  clearCursorHref = null
}: ExperimentAnalyticsPanelProps) {
  return (
    <section id="experiment-analytics" className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Experiment analytics</p>
          <h2 className="text-xl font-semibold text-white">Trend + guardrail health</h2>
          <p className="text-sm text-white/60">
            Visualize daily experiment assignments and keep stalled variants on your radar. Use these views before deep-dive exports.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          {conversionRequestCursor && clearCursorAction ? (
            <form action={clearCursorAction}>
              <input type="hidden" name="redirectTo" value={clearCursorHref ?? "/admin/onboarding#experiment-analytics"} />
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 px-3 py-1 text-[10px] text-amber-200 transition hover:border-amber-200 hover:text-amber-100"
              >
                <span className="text-[0.7rem]">↺</span> Clear cursor
              </button>
            </form>
          ) : null}
          <Link
            href="#experiment-export"
            className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40 underline-offset-4 hover:text-white/80 hover:underline"
          >
            Jump to export controls
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExperimentTrendCard series={trendSeries} />
        <VariantStatusCard entries={variantBreakdown} autoActions={autoActions} autoActionsRunAt={autoActionsRunAt} />
      </div>
      <ExperimentConversionCardClient
        initialEntries={conversionMetrics}
        initialCursor={conversionCursor}
        initialRequestCursor={conversionRequestCursor}
      />
      <QuickOrderFunnelCard
        funnel={quickOrderFunnel ?? null}
        exportStatus={quickOrderExportStatus ?? null}
        defaultView={quickOrderFunnelDefaultView}
        workflowTelemetry={guardrailWorkflowTelemetry ?? null}
      />
    </section>
  );
}

type ExperimentTrendCardProps = {
  series: ExperimentTrendSeries[];
};

function ExperimentTrendCard({ series }: ExperimentTrendCardProps) {
  return (
    <article className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Trending events</p>
          <h3 className="text-lg font-semibold text-white">Daily assignments</h3>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          {series.length > 0 ? `${series.length} tracked slugs` : "Telemetry pending"}
        </span>
      </header>

      {series.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/60">
          No experiment events were returned from the reporting API. Once telemetry flows, you will see per-slug sparklines here.
        </p>
      ) : (
        <div className="space-y-4">
          {series.map((entry) => (
            <article key={entry.slug} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
              <div className="flex flex-wrap items-end justify-between gap-4 text-sm text-white">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Slug</p>
                  <p className="text-base font-semibold text-white">{entry.slug}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Events</p>
                  <p className="text-lg font-semibold text-white">{entry.totalEvents}</p>
                  <p className="text-xs text-white/60">Last day {entry.latestCount}</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <svg viewBox="0 0 100 40" className="h-16 w-full text-emerald-300" role="img" aria-label={`Trend for ${entry.slug}`}>
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    points={entry.sparklinePoints}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <dl className="mt-3 space-y-1 text-[11px] text-white/60">
                  {entry.labels.slice(-3).map((label) => (
                    <div key={`${entry.slug}-${label.date}`} className="flex items-center justify-between">
                      <dt>{label.date}</dt>
                      <dd className="font-semibold text-white">{label.count}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

type VariantStatusCardProps = {
  entries: VariantStatusBreakdown[];
  autoActions?: ProviderAutoAction[];
  autoActionsRunAt?: string | null;
};

function VariantStatusCard({ entries, autoActions = [], autoActionsRunAt = null }: VariantStatusCardProps) {
  const formattedRunAt = formatAutoRunTimestamp(autoActionsRunAt);
  return (
    <article className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Stalled vs active</p>
          <h3 className="text-lg font-semibold text-white">Variant guardrails</h3>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          {entries.length > 0 ? `${entries.length} tracked variants` : "No journeys yet"}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/60">
          Journey summaries do not include pricing experiment assignments yet. As soon as variants appear, their active vs. stalled counts will populate here.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const total = entry.active + entry.stalled;
            const stalledPct = total === 0 ? 0 : Math.round((entry.stalled / total) * 100);
            const activePct = Math.max(0, 100 - stalledPct);
            return (
              <article key={`${entry.slug}-${entry.variantKey}`} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/40">{entry.slug}</p>
                    <p className="text-base font-semibold text-white">{entry.variantLabel}</p>
                    <p className="text-xs text-white/50">
                      {entry.active} active · {entry.stalled} stalled
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 text-[11px] font-semibold tracking-[0.3em] text-white/60">
                    <Link
                      href={`/admin/onboarding?experimentSlug=${entry.slug}&experimentVariant=${entry.variantKey}`}
                      className="text-emerald-200 underline-offset-4 hover:text-emerald-100 hover:underline"
                    >
                      Focus journeys
                    </Link>
                    <Link
                      href={`/admin/onboarding?experimentSlug=${entry.slug}#experiment-export`}
                      className="text-white/60 underline-offset-4 hover:text-white hover:underline"
                    >
                      Export CSV
                    </Link>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/10" role="presentation">
                    <span className="h-full bg-emerald-400/80" style={{ width: `${activePct}%` }} />
                    <span className="h-full bg-amber-400/80" style={{ width: `${stalledPct}%` }} />
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">
                    {activePct}% active · {stalledPct}% stalled
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {autoActions.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-emerald-300/30 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[0.6rem] uppercase tracking-[0.3em] text-emerald-100/70">
            <span>Auto guardrail actions</span>
            {formattedRunAt ? <span>Last run {formattedRunAt}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {autoActions.slice(0, 6).map((action, idx) => (
              <AutoGuardrailActionChip
                key={action.followUpId ?? `${action.providerId}-${action.action}-${idx}`}
                action={action}
                linkLabel="View follow-ups"
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatAutoRunTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}
