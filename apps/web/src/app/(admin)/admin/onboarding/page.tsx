import Link from "next/link";

import { AdminBreadcrumbs, AdminKpiCard, AdminTabNav } from "@/components/admin";
import { AutoGuardrailActionChip } from "@/components/admin/AutoGuardrailActionChip";
import {
  ProviderAutomationDrawer,
  type ProviderAutomationDrawerEntry
} from "@/components/admin/ProviderAutomationDrawer";
import {
  fetchOperatorJourneyDetail,
  fetchOperatorJourneys,
  type OperatorJourneySummary
} from "@/server/onboarding/journeys";
import { fetchOnboardingExperimentEvents } from "@/server/reporting/onboarding-experiment-events";
import { fetchExperimentConversionSnapshot } from "@/server/reporting/experiment-conversion-snapshot";
import { fetchGuardrailFollowUps } from "@/server/reporting/guardrail-followups";
import {
  fetchProviderAutomationHistory,
  fetchProviderAutomationStatus
} from "@/server/fulfillment/provider-automation-insights";
import { fetchQuickOrderFunnelMetrics } from "@/server/reporting/quick-order-funnel";
import { fetchQuickOrderExportStatus } from "@/server/reporting/quick-order-export-status";
import { fetchGuardrailWorkflowTelemetrySummary } from "@/server/reporting/guardrail-workflow-telemetry";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import type { OnboardingExperimentEvent } from "@/types/reporting";
import { collectAutoGuardrailActions, type ProviderAutoAction } from "@/lib/automation-actions";
import { buildSparklineFromCounts, chartDayFormatter, isoDateKey } from "@/lib/experiment-analytics";
import { clearExperimentConversionsCursor } from "./actions";

import { ADMIN_PRIMARY_TABS } from "../../admin-tabs";
import { ExperimentAnalyticsPanel, type ExperimentTrendSeries, type VariantStatusBreakdown } from "./experiment-analytics";
import { OnboardingFilters } from "./filters";
import { ManualNudgeForm } from "./manual-nudge-form";
import { OnboardingExperimentExportControls } from "./experiment-export.client";

// meta: route: admin/onboarding

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const TREND_DAYS = 10;
const MAX_TREND_SLUGS = 3;
const MAX_VARIANT_BREAKDOWN_ROWS = 6;
const MAX_CONVERSION_ROWS = 6;

const riskTone: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-200 border border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
};

const statusTone: Record<string, string> = {
  active: "bg-blue-500/15 text-blue-100 border border-blue-500/30",
  stalled: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
};

type AdminOnboardingPageProps = {
  searchParams?: {
    journeyId?: string;
    stalled?: string;
    referrals?: string;
    experimentSlug?: string;
    experimentVariant?: string;
    conversionCursor?: string;
  };
};

const ONBOARDING_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Operations", href: "/admin/onboarding" },
  { label: "Onboarding" }
];

function ExperimentExportSection() {
  return (
    <section id="experiment-export" className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Reporting</p>
        <h2 className="text-xl font-semibold text-white">Experiment export</h2>
        <p className="text-sm text-white/60">
          Download onboarding pricing experiment assignments with cursor pagination for analytics and data lake jobs.
        </p>
      </div>
      <OnboardingExperimentExportControls />
    </section>
  );
}

function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

function buildExperimentTrendSeries(events: OnboardingExperimentEvent[]): ExperimentTrendSeries[] {
  if (!events || events.length === 0) {
    return [];
  }

  const buckets = Array.from({ length: TREND_DAYS }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (TREND_DAYS - 1 - index));
    return {
      key: isoDateKey(date),
      label: chartDayFormatter.format(date)
    };
  });
  const indexByKey = new Map<string, number>(buckets.map((bucket, index) => [bucket.key, index]));
  const slugSeries = new Map<string, number[]>();

  for (const event of events) {
    const timestamp = new Date(event.recordedAt);
    if (Number.isNaN(timestamp.getTime())) {
      continue;
    }
    const bucketKey = isoDateKey(timestamp);
    const bucketIndex = indexByKey.get(bucketKey);
    if (bucketIndex === undefined) {
      continue;
    }
    let counts = slugSeries.get(event.slug);
    if (!counts) {
      counts = Array.from({ length: TREND_DAYS }, () => 0);
      slugSeries.set(event.slug, counts);
    }
    counts[bucketIndex] += 1;
  }

  return Array.from(slugSeries.entries())
    .map(([slug, counts]) => {
      const totalEvents = counts.reduce((sum, value) => sum + value, 0);
      return {
        slug,
        totalEvents,
        latestCount: counts[counts.length - 1] ?? 0,
        sparklinePoints: buildSparklineFromCounts(counts),
        labels: counts.map((count, index) => ({
          date: buckets[index]?.label ?? "",
          count
        }))
      };
    })
    .filter((entry) => entry.totalEvents > 0)
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, MAX_TREND_SLUGS);
}

function buildExperimentConversionMetrics(events: OnboardingExperimentEvent[]) {
  if (!events || events.length === 0) {
    return [];
  }
  const map = new Map<
    string,
    { orders: Set<string>; journeys: Set<string>; lastActivity: Date | null }
  >();
  for (const event of events) {
    const slug = event.slug;
    if (!slug) {
      continue;
    }
    const bucket =
      map.get(slug) ??
      {
        orders: new Set<string>(),
        journeys: new Set<string>(),
        lastActivity: null
      };
    if (event.orderId) {
      bucket.orders.add(event.orderId);
    }
    if (event.journeyId) {
      bucket.journeys.add(event.journeyId);
    }
    const timestamp = new Date(event.recordedAt);
    if (!Number.isNaN(timestamp.getTime())) {
      if (!bucket.lastActivity || timestamp > bucket.lastActivity) {
        bucket.lastActivity = timestamp;
      }
    }
    map.set(slug, bucket);
  }
  return Array.from(map.entries())
    .map(([slug, bucket]) => ({
      slug,
      orderCount: bucket.orders.size,
      journeyCount: bucket.journeys.size,
      lastActivity: bucket.lastActivity ? bucket.lastActivity.toISOString() : null
    }))
    .filter((entry) => entry.orderCount > 0 || entry.journeyCount > 0)
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) {
        return b.orderCount - a.orderCount;
      }
      return b.journeyCount - a.journeyCount;
    })
    .slice(0, MAX_CONVERSION_ROWS);
}

function buildVariantStatusBreakdown(summaries: OperatorJourneySummary[]): VariantStatusBreakdown[] {
  const entryMap = new Map<string, VariantStatusBreakdown>();

  for (const summary of summaries) {
    if (!summary.pricingExperiments?.length) {
      continue;
    }
    const isStalled = summary.status === "stalled";
    for (const experiment of summary.pricingExperiments) {
      if (!experiment.slug || !experiment.variantKey) {
        continue;
      }
      const key = `${experiment.slug}-${experiment.variantKey}`;
      const existing = entryMap.get(key);
      const target: VariantStatusBreakdown =
        existing ?? {
          slug: experiment.slug,
          variantKey: experiment.variantKey,
          variantLabel: experiment.variantName ?? experiment.variantKey,
          active: 0,
          stalled: 0
        };
      if (isStalled) {
        target.stalled += 1;
      } else {
        target.active += 1;
      }
      entryMap.set(key, target);
    }
  }

  return Array.from(entryMap.values())
    .filter((entry) => entry.active + entry.stalled > 0)
    .sort((a, b) => {
      const totalDelta = b.active + b.stalled - (a.active + a.stalled);
      if (totalDelta !== 0) {
        return totalDelta;
      }
      const slugCompare = a.slug.localeCompare(b.slug);
      if (slugCompare !== 0) {
        return slugCompare;
      }
      return a.variantLabel.localeCompare(b.variantLabel);
    })
    .slice(0, MAX_VARIANT_BREAKDOWN_ROWS);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return dateFormatter.format(new Date(value));
}

function buildClearCursorHref(searchParams?: AdminOnboardingPageProps["searchParams"]): string {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (!value || key === "conversionCursor") {
        continue;
      }
      params.set(key, value);
    }
  }
  const query = params.toString();
  const basePath = "/admin/onboarding";
  return query.length > 0 ? `${basePath}?${query}#experiment-analytics` : `${basePath}#experiment-analytics`;
}

function journeyLink(summary: OperatorJourneySummary, selected: boolean) {
  return (
    <Link
      href={`/admin/onboarding?journeyId=${summary.journeyId}`}
      className={`flex flex-col gap-2 rounded-2xl border border-white/10 p-4 transition ${
        selected ? "bg-white/10" : "bg-black/30 hover:border-white/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">
          {summary.orderNumber ?? summary.orderId.slice(0, 8)}
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            statusTone[summary.status] ?? "bg-white/10 text-white/70 border border-white/20"
          }`}
        >
          {summary.status.replace("_", " ")}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>Progress {formatPercentage(summary.progressPercentage)}</span>
        <span>Updated {formatDate(summary.updatedAt)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{summary.totalTasks - summary.completedTasks} tasks open</span>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
            riskTone[summary.riskLevel] ?? "bg-white/10 text-white/70 border border-white/20"
          }`}
        >
          {summary.riskLevel} risk
        </span>
      </div>
    </Link>
  );
}

export default async function AdminOnboardingPage({ searchParams }: AdminOnboardingPageProps) {
  const showStalledOnly = searchParams?.stalled === "true";
  const showReferralsOnly = searchParams?.referrals === "true";
  const experimentSlug = searchParams?.experimentSlug ?? null;
  const experimentVariant = searchParams?.experimentVariant ?? null;
  const conversionCursorParam =
    typeof searchParams?.conversionCursor === "string" && searchParams.conversionCursor.length > 0
      ? searchParams.conversionCursor
      : null;
  const clearCursorHref = buildClearCursorHref(searchParams);

  const [
    { summaries, aggregates },
    experimentEventResponse,
    conversionSnapshot,
    providerAutomationStatus,
    providerAutomationHistory,
    quickOrderFunnel,
    quickOrderExportStatus,
    guardrailWorkflowTelemetry
  ] = await Promise.all([
    fetchOperatorJourneys({
      stalled: showStalledOnly,
      referrals: showReferralsOnly,
      experimentSlug,
      experimentVariant
    }),
    fetchOnboardingExperimentEvents({ limit: 500 }),
    fetchExperimentConversionSnapshot({ limit: 8, cursor: conversionCursorParam }).catch(() => ({
      metrics: [],
      nextCursor: null,
    })),
    fetchProviderAutomationStatus().catch(() => null),
    fetchProviderAutomationHistory(6).catch(() => null),
    fetchQuickOrderFunnelMetrics().catch(() => null),
    fetchQuickOrderExportStatus().catch(() => null),
    fetchGuardrailWorkflowTelemetrySummary().catch(() => null)
  ]);

  const csrfToken = getOrCreateCsrfToken();
  const experimentTrendSeries = buildExperimentTrendSeries(experimentEventResponse.events);
  const variantStatusBreakdown = buildVariantStatusBreakdown(summaries);
  const experimentConversionMetrics =
    conversionSnapshot.metrics.length > 0
      ? conversionSnapshot.metrics
      : buildExperimentConversionMetrics(experimentEventResponse.events);
  const autoActionSource = providerAutomationStatus?.alerts ?? providerAutomationHistory?.alerts?.[0] ?? null;
  const autoGuardrailActions: ProviderAutoAction[] = autoActionSource
    ? collectAutoGuardrailActions(autoActionSource).slice(0, 6)
    : [];
  const autoActionRunAt = autoActionSource?.ranAt ?? null;
  const guardrailLastRunLabel = autoActionRunAt ? formatDate(autoActionRunAt) : null;

  if (summaries.length === 0) {
    return (
      <div className="space-y-8">
      <AdminBreadcrumbs items={ONBOARDING_BREADCRUMBS} />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />
      {conversionCursorParam ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p>
            Conversions are pinned to historical cursor{" "}
            <code className="rounded bg-amber-400/20 px-1 py-0.5 font-mono text-xs text-amber-50">{conversionCursorParam}</code>. Use
            the analytics panel to reset back to the latest snapshot.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={clearExperimentConversionsCursor}>
              <input type="hidden" name="redirectTo" value={clearCursorHref} />
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-amber-200/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-amber-50 transition hover:border-amber-100 hover:text-amber-100"
              >
                Clear conversions cursor
              </button>
            </form>
            <span className="text-xs uppercase tracking-[0.3em] text-amber-100/70">
              Resetting shows the newest conversion slice
            </span>
          </div>
        </div>
      ) : null}
        <section className="flex min-h-[18rem] flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-12 text-center text-white/60 backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">Operations</p>
          <h1 className="text-3xl font-semibold text-white">Onboarding command center</h1>
          <p className="max-w-xl text-sm text-white/70">
            Concierge visibility, stalled-task filters, and referral tracking will appear as soon as the first orders complete checkout.
          </p>
        </section>
        <ExperimentAnalyticsPanel
          trendSeries={experimentTrendSeries}
          variantBreakdown={variantStatusBreakdown}
          conversionMetrics={experimentConversionMetrics}
          conversionCursor={conversionSnapshot.nextCursor}
          conversionRequestCursor={conversionCursorParam}
          quickOrderFunnel={quickOrderFunnel ?? null}
          quickOrderExportStatus={quickOrderExportStatus ?? null}
          quickOrderFunnelDefaultView="local"
          guardrailWorkflowTelemetry={guardrailWorkflowTelemetry ?? null}
          autoActions={autoGuardrailActions}
          autoActionsRunAt={autoActionRunAt}
          clearCursorAction={clearExperimentConversionsCursor}
          clearCursorHref={clearCursorHref}
        />
        <ExperimentExportSection />
      </div>
    );
  }

  const requestedJourneyId = searchParams?.journeyId ?? null;
  const selectedJourneyId = requestedJourneyId && summaries.some((entry) => entry.journeyId === requestedJourneyId)
    ? requestedJourneyId
    : summaries[0].journeyId;

  const detail = await fetchOperatorJourneyDetail(selectedJourneyId);
  const providerAutomationDrawerEntries: ProviderAutomationDrawerEntry[] =
    detail.providerAutomation && detail.providerAutomation.length > 0
      ? await Promise.all(
          detail.providerAutomation.map(async (provider) => ({
            providerId: provider.providerId,
            providerName: provider.providerName ?? null,
            orderItems: provider.orderItems ?? [],
            guardrailStatus: provider.guardrailStatus ?? null,
            followUps: await fetchGuardrailFollowUps({
              providerId: provider.providerId,
              limit: 5,
            }),
          })),
        )
      : [];
  const guardrailDrawerDefaultOpen = providerAutomationDrawerEntries.some(
    (entry) => entry.followUps.entries.length > 0,
  );
  const experimentBuckets = new Map<
    string,
    { slug: string; total: number; variants: Map<string, { key: string; label: string; count: number }> }
  >();
  for (const summary of summaries) {
    if (!summary.pricingExperiments?.length) {
      continue;
    }
    const seenSlugs = new Set<string>();
    for (const experiment of summary.pricingExperiments) {
      if (!experiment.slug || !experiment.variantKey) {
        continue;
      }
      const slugKey = experiment.slug;
      let bucket = experimentBuckets.get(slugKey);
      if (!bucket) {
        bucket = { slug: slugKey, total: 0, variants: new Map() };
        experimentBuckets.set(slugKey, bucket);
      }
      if (!seenSlugs.has(slugKey)) {
        bucket.total += 1;
        seenSlugs.add(slugKey);
      }
      const variantKey = experiment.variantKey;
      const variantEntry = bucket.variants.get(variantKey) ?? {
        key: variantKey,
        label: experiment.variantName ?? variantKey,
        count: 0
      };
      variantEntry.count += 1;
      bucket.variants.set(variantKey, variantEntry);
    }
  }
  const experimentFilters = Array.from(experimentBuckets.values())
    .map((bucket) => ({
      slug: bucket.slug,
      total: bucket.total,
      variants: Array.from(bucket.variants.values()).sort((a, b) => a.label.localeCompare(b.label))
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const experimentInsights = experimentFilters.map((bucket) => ({
    slug: bucket.slug,
    total: bucket.total,
    variants: bucket.variants.slice(0, 3)
  }));

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={ONBOARDING_BREADCRUMBS}
        trailingAction={<span className="text-xs uppercase tracking-[0.3em] text-white/40">Concierge SLA: 4h</span>}
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard label="Journeys" value={aggregates.total} />
        <AdminKpiCard label="Active" value={aggregates.active} change={{ direction: "up", label: `+${aggregates.active}` }} />
        <AdminKpiCard
          label="Stalled"
          value={aggregates.stalled}
          change={{ direction: aggregates.stalled > 0 ? "up" : "flat", label: aggregates.stalled > 0 ? "Needs action" : "Healthy" }}
        />
        <AdminKpiCard label="Referral journeys" value={aggregates.withReferrals} footer="Guardrail overrides monitored" />
      </section>

      <ExperimentAnalyticsPanel
        trendSeries={experimentTrendSeries}
        variantBreakdown={variantStatusBreakdown}
        conversionMetrics={experimentConversionMetrics}
        conversionCursor={conversionSnapshot.nextCursor}
        conversionRequestCursor={conversionCursorParam}
        quickOrderFunnel={quickOrderFunnel ?? null}
        quickOrderExportStatus={quickOrderExportStatus ?? null}
        quickOrderFunnelDefaultView="local"
        guardrailWorkflowTelemetry={guardrailWorkflowTelemetry ?? null}
        autoActions={autoGuardrailActions}
        autoActionsRunAt={autoActionRunAt}
        clearCursorAction={clearExperimentConversionsCursor}
        clearCursorHref={clearCursorHref}
      />

      {experimentInsights.length > 0 ? (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Pricing experiments</p>
              <h2 className="text-xl font-semibold text-white">Concierge insights</h2>
              <p className="text-sm text-white/60">
                Snapshot of journeys influenced by each slug. Click a variant to filter the table and triage relevant orders.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
              {experimentInsights.length} active slugs
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {experimentInsights.map((entry) => (
              <div key={entry.slug} className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-white/40">Slug</p>
                    <p className="text-lg font-semibold text-white">{entry.slug}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Journeys</p>
                    <p className="text-xl font-semibold text-white">{entry.total}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {entry.variants.length === 0 ? (
                    <p className="text-xs text-white/60">No variants recorded yet.</p>
                  ) : (
                    entry.variants.map((variant) => (
                      <div
                        key={variant.key}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/70"
                      >
                        <div className="space-y-0.5">
                          <p className="font-semibold text-white">{variant.label}</p>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Triggered {variant.count}x</p>
                        </div>
                        <Link
                          href={`/admin/onboarding?experimentSlug=${entry.slug}&experimentVariant=${variant.key}`}
                          className="text-[11px] font-semibold text-emerald-300 underline-offset-4 hover:underline"
                        >
                          Focus
                        </Link>
                      </div>
                    ))
                  )}
                </div>
                <Link
                  href={`/admin/onboarding?experimentSlug=${entry.slug}`}
                  className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  View journeys
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ExperimentExportSection />

      <div className="grid gap-8 lg:grid-cols-[2fr,3fr]">
        <section className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Journeys</h2>
              <p className="text-sm text-white/60">Segment and triage onboarding progress across cohorts.</p>
            </div>
            <OnboardingFilters experimentFilters={experimentFilters} />
          </div>
          <div className="grid gap-3">
            {summaries.map((summary) => journeyLink(summary, summary.journeyId === selectedJourneyId))}
          </div>
        </section>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Journey</p>
              <h2 className="text-2xl font-semibold text-white">
                {detail.orderNumber ?? detail.orderId.slice(0, 8)}
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/60">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  statusTone[detail.status] ?? "bg-white/10 text-white/70 border border-white/20"
                }`}
              >
                {detail.status.replace("_", " ")}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                  riskTone[detail.riskLevel] ?? "bg-white/10 text-white/70 border border-white/20"
                }`}
              >
                {detail.riskLevel} risk
              </span>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminKpiCard label="Progress" value={formatPercentage(detail.progressPercentage)} />
            <AdminKpiCard label="Referral" value={detail.referralCode ?? "—"} />
            <AdminKpiCard label="Started" value={formatDate(detail.startedAt)} />
            <AdminKpiCard label="Updated" value={formatDate(detail.updatedAt)} />
          </div>

          {detail.pricingExperiments.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">
                Pricing experiments
              </h3>
              <div className="space-y-2">
                {detail.pricingExperiments.map((experiment) => (
                  <article
                    key={`${experiment.slug}-${experiment.variantKey}`}
                    className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-white/80"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">{experiment.slug}</p>
                        <p className="text-base font-semibold text-white">{experiment.variantName ?? experiment.variantKey}</p>
                      </div>
                      <span className="rounded-full border border-amber-200/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-amber-100">
                        {experiment.isControl ? "Control" : "Challenger"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-white/60">
                      <p>Variant key: {experiment.variantKey}</p>
                      <p>Assignment: {experiment.assignmentStrategy ?? "—"}</p>
                      <p>Captured: {formatDate(experiment.recordedAt ?? null)}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {(autoGuardrailActions.length > 0 ||
            providerAutomationDrawerEntries.length > 0 ||
            guardrailWorkflowTelemetry) ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Guardrail automation</h3>
                {guardrailLastRunLabel ? (
                  <span className="text-[11px] uppercase tracking-[0.3em] text-white/40">Last run {guardrailLastRunLabel}</span>
                ) : null}
              </div>
              {autoGuardrailActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {autoGuardrailActions.map((action, idx) => (
                    <AutoGuardrailActionChip
                      key={action.followUpId ?? `${action.providerId}-${action.action}-${idx}`}
                      action={action}
                    />
                  ))}
                </div>
              ) : null}
              <ProviderAutomationDrawer
                providers={providerAutomationDrawerEntries}
                defaultOpen={guardrailDrawerDefaultOpen}
                workflowTelemetry={guardrailWorkflowTelemetry ?? null}
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Tasks</h3>
            <div className="space-y-2">
              {detail.tasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between text-sm text-white">
                    <p className="font-semibold">{task.title}</p>
                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">{task.status}</span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
                    <p>Due: {formatDate(task.dueAt)}</p>
                    <p>Completed: {formatDate(task.completedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Recent interactions</h3>
            <div className="space-y-3">
              {detail.interactions.slice(0, 6).map((interaction) => (
                <article key={interaction.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>
                      {interaction.actor} via {interaction.channel}
                    </span>
                    <span>{formatDate(interaction.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{interaction.summary ?? "Interaction"}</p>
                  {interaction.details && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs text-white/60">
                      {interaction.details}
                    </pre>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Concierge nudges</h3>
            {detail.nudgeOpportunities.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-white/60">
                No automated nudges pending for this journey.
              </p>
            ) : (
              <div className="space-y-3">
                {detail.nudgeOpportunities.map((opportunity) => (
                  <article key={opportunity.dedupeKey} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-50">
                    <header className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-amber-200/80">
                      <span>{opportunity.reason.replace("_", " ")}</span>
                      <span>{opportunity.recommendedChannel}</span>
                    </header>
                    <p className="mt-2 font-semibold text-amber-50">{opportunity.subject}</p>
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-amber-100/80">{opportunity.message}</pre>
                    <p className="mt-3 text-[11px] uppercase tracking-[0.3em] text-amber-200/70">
                      SLA expires {formatDate(opportunity.slaExpiresAt)} • Idle {opportunity.idleHours}h
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <ManualNudgeForm
            journeyId={detail.journeyId}
            tasks={detail.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status }))}
            csrfToken={csrfToken}
          />
        </section>
      </div>
    </div>
  );
}
