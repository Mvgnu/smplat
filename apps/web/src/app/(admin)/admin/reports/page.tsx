import Link from "next/link";
import { Users } from "lucide-react";

import { AdminBreadcrumbs, AdminTabNav } from "@/components/admin";
import { AutoGuardrailActionChip } from "@/components/admin/AutoGuardrailActionChip";
import { GuardrailAlertActions } from "@/components/admin/GuardrailAlertActions";
import { CopyEscalationSnippetButton } from "@/components/admin/CopyEscalationSnippetButton";
import { RunGuardrailExportButton } from "@/components/admin/RunGuardrailExportButton";
import { GuardrailFollowUpTimeline } from "@/components/admin/GuardrailFollowUpTimeline";
import { GuardrailFollowUpQueueClient } from "@/components/admin/GuardrailFollowUpQueue.client";
import { GuardrailSlackWorkflowSnippet } from "@/components/admin/GuardrailSlackWorkflowSnippet.client";
import { MetricSourcingTestbed } from "@/components/admin/MetricSourcingTestbed.client";
import { fetchOnboardingExperimentEvents } from "@/server/reporting/onboarding-experiment-events";
import {
  fetchAutomationWorkflowStatus,
  fetchExperimentAnalyticsOverview,
  fetchGuardrailAlerts
} from "@/server/reporting/guardrail-alerts";
import { fetchExperimentConversionSnapshot } from "@/server/reporting/experiment-conversion-snapshot";
import { fetchGuardrailFollowUps } from "@/server/reporting/guardrail-followups";
import { fetchGuardrailExportStatus } from "@/server/reporting/guardrail-export-status";
import { fetchQuickOrderExportStatus } from "@/server/reporting/quick-order-export-status";
import { fetchGuardrailWorkflowTelemetrySummary } from "@/server/reporting/guardrail-workflow-telemetry";
import type {
  AutomationWorkflowStatus,
  GuardrailAlert,
  GuardrailFollowUpFeed,
  GuardrailExportStatus,
  QuickOrderExportStatus
} from "@/types/reporting";
import type { GuardrailQueueEntry } from "@/types/guardrail-queue";
import {
  fetchProviderAutomationSnapshot,
  fetchProviderAutomationHistory,
  type ProviderAutomationSnapshot,
  type ProviderAutomationHistory
} from "@/server/fulfillment/provider-automation-insights";
import { formatPlatformContextLabel } from "@/lib/platform-context";
import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import { GuardrailWorkflowTelemetryCard } from "./guardrail-workflow-telemetry-card.client";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";
import { formatTimestamp } from "@/lib/format-timestamp";
import { ProviderAutomationHistoryPanel } from "./ProviderAutomationHistoryPanel.client";
import { extractSummaryNumber } from "./summary-helpers";

import { ADMIN_PRIMARY_TABS } from "../../admin-tabs";
import { ExperimentAnalyticsPanel } from "../onboarding/experiment-analytics";
import { OnboardingExperimentExportControls } from "../onboarding/experiment-export.client";
import { clearReportingConversionCursor } from "./actions";

const REPORTING_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Reporting" }
];

const limit = 15;
const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.smplat.local").replace(/\/$/, "");
const DEFAULT_GUARDRAIL_WORKFLOW_URL =
  process.env.GUARDRAIL_EXPORT_WORKFLOW_URL ??
  "https://github.com/smplat/smplat/actions/workflows/guardrail-followup-export.yml";
const DEFAULT_QUICK_ORDER_WORKFLOW_URL =
  process.env.QUICK_ORDER_EXPORT_WORKFLOW_URL ??
  "https://github.com/smplat/smplat/actions/workflows/quick-order-telemetry-export.yml";
const CAN_TRIGGER_GUARDRAIL_EXPORT = Boolean(
  process.env.GUARDRAIL_EXPORT_TRIGGER_URL && process.env.GUARDRAIL_EXPORT_TRIGGER_TOKEN,
);

type AdminReportingPageProps = {
  searchParams?: {
    conversionCursor?: string;
  };
};

function buildClearCursorHref(searchParams?: AdminReportingPageProps["searchParams"]): string {
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
  const basePath = "/admin/reports";
  return query.length > 0 ? `${basePath}?${query}#experiment-analytics` : `${basePath}#experiment-analytics`;
}

export default async function AdminReportingPage({ searchParams }: AdminReportingPageProps) {
  const conversionCursorParam =
    typeof searchParams?.conversionCursor === "string" && searchParams.conversionCursor.length > 0
      ? searchParams.conversionCursor
      : null;
  const clearCursorHref = buildClearCursorHref(searchParams);
  const conversionHref = conversionCursorParam
    ? `${APP_BASE_URL}/admin/reports?conversionCursor=${encodeURIComponent(conversionCursorParam)}#experiment-analytics`
    : `${APP_BASE_URL}/admin/reports#experiment-analytics`;
  const [
    { events, nextCursor },
    guardrailAlerts,
    automationWorkflow,
    analyticsOverview,
    conversionSnapshot,
    providerSnapshot,
    providerHistory,
    guardrailExportStatus,
    quickOrderExportStatus,
    guardrailWorkflowTelemetry,
  ] = await Promise.all([
    fetchOnboardingExperimentEvents({ limit }),
    fetchGuardrailAlerts(),
    fetchAutomationWorkflowStatus(),
    fetchExperimentAnalyticsOverview(),
    fetchExperimentConversionSnapshot({ limit: 8, cursor: conversionCursorParam }).catch(() => ({
      metrics: [],
      nextCursor: null,
    })),
    fetchProviderAutomationSnapshot(25).catch(() => null),
    fetchProviderAutomationHistory(8).catch(() => null),
    fetchGuardrailExportStatus(),
    fetchQuickOrderExportStatus(),
    fetchGuardrailWorkflowTelemetrySummary().catch(() => null),
  ]);

  const guardrailProviderIds = Array.from(new Set(guardrailAlerts.map((alert) => alert.providerId)));
  const followUpsByProvider: Record<string, GuardrailFollowUpFeed> =
    guardrailProviderIds.length === 0
      ? {}
      : Object.fromEntries(
          await Promise.all(
            guardrailProviderIds.map(async (providerId) => {
              try {
                const feed = await fetchGuardrailFollowUps({ providerId, limit: 5 });
                return [providerId, feed] as const;
              } catch {
                return [
                  providerId,
                  {
                    entries: [],
                    nextCursor: null,
                    status: null,
                    providerTelemetry: null
                  } as GuardrailFollowUpFeed
                ] as const;
              }
            })
          )
        );

  const guardrailSummary = summarizeGuardrailAlerts(guardrailAlerts, followUpsByProvider);
  const followUpQueue = buildGuardrailFollowUpQueue(followUpsByProvider, guardrailAlerts);

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs items={REPORTING_BREADCRUMBS} />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />
      {conversionCursorParam ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p>
            Conversions are pinned to historical cursor{" "}
            <code className="rounded bg-amber-400/20 px-1 py-0.5 font-mono text-xs text-amber-50">{conversionCursorParam}</code>. Use
            the controls below to load newer slices or jump back to the live snapshot.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={clearReportingConversionCursor}>
              <input type="hidden" name="redirectTo" value={clearCursorHref} />
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-amber-200/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-amber-50 transition hover:border-amber-100 hover:text-amber-100"
              >
                Clear conversions cursor
              </button>
            </form>
            <span className="text-xs uppercase tracking-[0.3em] text-amber-100/70">
              Resetting jumps to the latest conversion snapshot
            </span>
          </div>
        </div>
      ) : null}

      <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Metric sourcing</p>
          <h2 className="text-2xl font-semibold text-white">Account validation testbed</h2>
          <p className="text-sm text-white/60">
            Hit the FastAPI `/metrics/accounts/validate` endpoint from the admin panel to capture baseline snapshots,
            exercise the third-party scraper integration, and persist manual overrides while Track 0 hardens.
          </p>
        </div>
        <MetricSourcingTestbed />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Exports</p>
          <h1 className="text-2xl font-semibold text-white">Onboarding experiment telemetry</h1>
          <p className="text-sm text-white/60">
            Download CSVs, trigger webhook exports, and inspect the latest rows flowing through the onboarding reporting feed.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">CSV download</h2>
              <p className="text-sm text-white/60">
                Pull 100–500 rows per batch directly from the protected reporting API. Use “Download next page” to step through pagination via `nextCursor`.
              </p>
            </div>
            <OnboardingExperimentExportControls />
          </div>

          <AutomationStatusCard status={automationWorkflow} />
          <GuardrailExportStatusCard status={guardrailExportStatus} canTrigger={CAN_TRIGGER_GUARDRAIL_EXPORT} />
          <QuickOrderExportStatusCard status={quickOrderExportStatus} workflowTelemetry={guardrailWorkflowTelemetry} />
        </div>
      </section>

      <GuardrailAlertSummary summary={guardrailSummary} />
      <GuardrailAutomationPlaybook conversionCursor={conversionCursorParam} conversionHref={conversionHref} />
      <GuardrailWorkflowTelemetryCard initialSummary={guardrailWorkflowTelemetry} limit={500} />
      <GuardrailFollowUpQueue entries={followUpQueue} workflowTelemetry={guardrailWorkflowTelemetry ?? null} />
      <GuardrailAlertsPanel
        alerts={guardrailAlerts}
        followUpsByProvider={followUpsByProvider}
        conversionCursor={conversionCursorParam}
        conversionHref={conversionHref}
      />

      {analyticsOverview ? (
        <ExperimentAnalyticsPanel
          trendSeries={analyticsOverview.trendSeries}
          variantBreakdown={analyticsOverview.variantBreakdown}
          conversionMetrics={
            conversionSnapshot.metrics.length > 0 ? conversionSnapshot.metrics : analyticsOverview.conversionMetrics
          }
          conversionCursor={conversionSnapshot.nextCursor}
          conversionRequestCursor={conversionCursorParam}
          quickOrderFunnel={analyticsOverview.quickOrderFunnel}
          quickOrderExportStatus={quickOrderExportStatus}
          quickOrderFunnelDefaultView="export"
          clearCursorAction={clearReportingConversionCursor}
          clearCursorHref={clearCursorHref}
        />
      ) : null}

      {providerSnapshot ? <ProviderAutomationSnapshotPanel snapshot={providerSnapshot} /> : null}
      {providerHistory ? (
        <ProviderAutomationHistoryPanel history={providerHistory} initialWorkflowTelemetry={guardrailWorkflowTelemetry} />
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Latest rows</p>
            <h2 className="text-xl font-semibold text-white">Most recent experiment events</h2>
            <p className="text-sm text-white/60">
              Snapshot of the last {limit} rows returned by the reporting endpoint. Use this to confirm automation freshness and payload shape.
            </p>
          </div>
          {nextCursor && (
            <p className="text-xs font-semibold text-white/60">
              Next cursor: <span className="text-white">{formatTimestamp(nextCursor)}</span>
            </p>
          )}
        </div>

        {events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/20 p-8 text-center text-white/60">
            No experiment telemetry found. Ensure checkout/success/account flows are emitting pricing experiment events and that the API credentials are configured.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm text-white/80">
              <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-white/60">
                <tr>
                  <th className="px-4 py-3">Recorded</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Variant</th>
                  <th className="px-4 py-3">Control?</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Feature Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-black/20">
                {events.map((event) => (
                  <tr key={event.eventId}>
                    <td className="px-4 py-3 font-mono text-xs text-white/70">{formatTimestamp(event.recordedAt)}</td>
                    <td className="px-4 py-3 text-white">{event.slug}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{event.variantName ?? event.variantKey}</div>
                      <p className="text-xs text-white/60">{event.variantKey}</p>
                    </td>
                    <td className="px-4 py-3 text-white/70">{event.isControl ? "Control" : "Challenger"}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{event.orderNumber ?? event.orderId}</div>
                      <p className="text-xs text-white/60">{event.journeyId}</p>
                    </td>
                    <td className="px-4 py-3 text-white/70">{event.featureFlagKey ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type AutomationStatusCardProps = {
  status: AutomationWorkflowStatus;
};

function AutomationStatusCard({ status }: AutomationStatusCardProps) {
  const statusTone: Record<AutomationWorkflowStatus["lastRunStatus"], string> = {
    success: "text-emerald-200 border-emerald-400/30 bg-emerald-400/10",
    warning: "text-amber-200 border-amber-400/30 bg-amber-400/10",
    failed: "text-rose-200 border-rose-400/30 bg-rose-400/10"
  };
  const alertsDispatched = extractSummaryNumber(status.summary, "alertsSent");
  const loadAlerts = extractSummaryNumber(status.summary, "loadAlerts");

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Automation</h2>
          <p className="text-sm text-white/60">{status.description}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${statusTone[status.lastRunStatus]}`}>
          {status.lastRunStatus}
        </span>
      </div>
      <dl className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Workflow</dt>
          <dd className="font-semibold text-white">{status.workflow}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Last run</dt>
          <dd className="font-mono text-xs text-white/80">{formatTimestamp(status.lastRunAt)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Duration</dt>
          <dd>{status.durationSeconds != null ? `${status.durationSeconds}s` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Next ETA</dt>
          <dd className="font-mono text-xs text-white/80">{status.nextRunEta ? formatTimestamp(status.nextRunEta) : "TBD"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Latest cursor</dt>
          <dd className="font-mono text-xs text-white/80">{status.latestCursor ? formatTimestamp(status.latestCursor) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Alerts dispatched</dt>
          <dd className="font-semibold text-white">{alertsDispatched}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-white/50">Load alerts</dt>
          <dd className="font-semibold text-white">{loadAlerts}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3 text-xs font-semibold">
        {status.actionUrl ? (
          <a
            href={status.actionUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:border-white/50 hover:text-white"
          >
            View workflow
          </a>
        ) : null}
        {status.runbookUrl ? (
          <Link
            href={status.runbookUrl}
            className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:border-white/50 hover:text-white"
          >
            Runbook
          </Link>
        ) : null}
      </div>
    </div>
  );
}

type GuardrailSummary = {
  criticalCount: number;
  warningCount: number;
  pausedCount: number;
  pendingCount: number;
  followUpCount: number;
};

type GuardrailAlertSummaryProps = {
  summary: GuardrailSummary;
};

function GuardrailAlertSummary({ summary }: GuardrailAlertSummaryProps) {
  const cards = [
    {
      label: "Critical alerts",
      value: summary.criticalCount,
      hint: summary.criticalCount > 0 ? "Auto-pause or escalate immediately" : "No blocking alerts",
      tone: "text-rose-100 border-rose-400/40 bg-rose-400/10"
    },
    {
      label: "Warnings",
      value: summary.warningCount,
      hint: summary.warningCount > 0 ? "Monitor guardrails closely" : "Healthy",
      tone: "text-amber-100 border-amber-300/40 bg-amber-300/10"
    },
    {
      label: "Paused variants",
      value: summary.pausedCount,
      hint: "Logged via follow-up timelines",
      tone: "text-sky-100 border-sky-400/40 bg-sky-400/10"
    },
    {
      label: "Pending follow-ups",
      value: summary.pendingCount,
      hint: summary.pendingCount > 0 ? "Log actions before next run" : "All alerts documented",
      tone: "text-white border-white/20 bg-white/5"
    }
  ];

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Guardrail posture</p>
          <h2 className="text-xl font-semibold text-white">Automation badges</h2>
          <p className="text-sm text-white/60">
            Use these badges to decide whether to auto-pause, resume, or escalate before diving into detailed alerts.
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          {summary.followUpCount} follow-ups logged
        </span>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className={`space-y-2 rounded-2xl border px-4 py-3 ${card.tone}`}>
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">{card.label}</p>
            <p className="text-3xl font-semibold">{card.value}</p>
            <p className="text-xs text-white/70">{card.hint}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

type GuardrailAutomationPlaybookProps = {
  conversionCursor: string | null;
  conversionHref: string;
};

function GuardrailAutomationPlaybook({ conversionCursor, conversionHref }: GuardrailAutomationPlaybookProps) {
  const conversionLabel = conversionCursor ? "Historical conversion slice" : "Live conversion snapshot";
  const cursorHint = conversionCursor ? ` (cursor ${conversionCursor})` : "";
  const slackTemplate =
    `:warning: Guardrail alert for *{providerName}* \`{slug}\`\n` +
    `• Failures: {guardrailFailures} · Replays: {replayFailures}/{replayTotal}\n` +
    `• Action: {actionTaken} (notes: {notes})\n` +
    `<${APP_BASE_URL}/admin/fulfillment/providers/{providerId}?tab=automation|Open dashboard>\n` +
    `${conversionLabel}: ${conversionHref}${cursorHint}`;

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Playbook</p>
          <h2 className="text-xl font-semibold text-white">Guardrail automation workflow</h2>
          <p className="text-sm text-white/60">
            Escalate critical alerts to Slack, auto-pause risky variants, and document concierge follow-ups before handing off to the ops
            team.
          </p>
        </div>
        <Link
          href="/docs/runbooks/pricing-experiments-operator"
          className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40 underline-offset-4 hover:text-white/80 hover:underline"
        >
          View runbook
        </Link>
      </header>
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Slack template</p>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/50 p-4 text-xs text-white/80">{slackTemplate}</pre>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-white/80">
        <span className="rounded-full border border-white/20 px-3 py-1">Threshold: &gt;2 fails or &gt;4 replays</span>
        <span className="rounded-full border border-white/20 px-3 py-1">Auto-pause: pause + log follow-up</span>
        <span className="rounded-full border border-white/20 px-3 py-1">Resume: document note + link alert</span>
      </div>
    </section>
  );
}

type GuardrailAlertsPanelProps = {
  alerts: GuardrailAlert[];
  followUpsByProvider: Record<string, GuardrailFollowUpFeed>;
  conversionCursor: string | null;
  conversionHref: string;
};

type GuardrailFollowUpQueueProps = {
  entries: GuardrailQueueEntry[];
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

function GuardrailFollowUpQueue({ entries, workflowTelemetry = null }: GuardrailFollowUpQueueProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Automation queue</p>
          <h2 className="text-xl font-semibold text-white">Recent follow-ups</h2>
          <p className="text-sm text-white/60">
            Snapshot of the latest guardrail actions logged via the dashboard. Use the filters to focus on critical or warning alerts and
            jump into the provider automation view directly.
          </p>
        </div>
      </header>
      <div className="mt-4">
        <GuardrailFollowUpQueueClient entries={entries} workflowTelemetry={workflowTelemetry ?? null} />
      </div>
    </section>
  );
}

type GuardrailExportStatusCardProps = {
  status: GuardrailExportStatus | null;
  canTrigger: boolean;
};

function GuardrailExportStatusCard({ status, canTrigger }: GuardrailExportStatusCardProps) {
  const downloadAvailable = Boolean(status?.downloadUrl);
  const proxyDownloadHref = downloadAvailable ? "/api/reporting/guardrail-followups/export" : null;
  const workflowUrl = status?.workflowUrl ?? DEFAULT_GUARDRAIL_WORKFLOW_URL;
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Guardrail export health</h2>
        <p className="text-sm text-white/60">
          Snapshot of the hourly guardrail follow-up exporter. Cursor metadata mirrors the Snowflake ingest runbook so ops can validate freshness.
        </p>
      </div>
      {status ? (
        <>
          <dl className="grid gap-3 text-sm text-white/70">
            <div>
              <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Rows exported</dt>
              <dd className="text-white">{status.rows ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Next cursor</dt>
              <dd className="font-mono text-xs text-white/80">{status.cursor ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Updated</dt>
              <dd className="font-mono text-xs text-white/80">{formatTimestamp(status.updatedAt)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white">
            {proxyDownloadHref ? (
              <a
                href={proxyDownloadHref}
                className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white transition hover:border-white/60 hover:text-white"
              >
                Download latest NDJSON
              </a>
            ) : (
              <span className="rounded-full border border-white/10 px-3 py-1 text-white/40">
                Download link unavailable
              </span>
            )}
            <a
              href={workflowUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white/70 transition hover:border-white/60 hover:text-white"
            >
              View workflow
            </a>
          </div>
          <RunGuardrailExportButton disabled={!canTrigger} />
          {!canTrigger ? (
            <p className="text-xs text-white/50">
              Configure `GUARDRAIL_EXPORT_TRIGGER_URL` + token to enable one-click reruns.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-white/50">
          Unable to load export status. Confirm `GUARDRAIL_EXPORT_STATUS_URL` is configured or open the workflow directly to inspect recent runs.
        </p>
      )}
    </div>
  );
}

type QuickOrderExportStatusCardProps = {
  status: QuickOrderExportStatus | null;
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

function QuickOrderExportStatusCard({ status, workflowTelemetry }: QuickOrderExportStatusCardProps) {
  const downloadAvailable = Boolean(status?.downloadUrl);
  const proxyDownloadHref = downloadAvailable ? "/api/reporting/quick-order-export" : "/api/telemetry/quick-order/export";
  const workflowUrl = status?.workflowUrl ?? DEFAULT_QUICK_ORDER_WORKFLOW_URL;
  const metrics = status?.metrics ?? null;
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Quick-order export</h2>
        <p className="text-sm text-white/60">
          Mirrors the `.telemetry/quick-order-events.ndjson` window into Snowflake/S3 every 30 minutes. Compare local telemetry against the
          export snapshot and download NDJSON directly from the dashboard.
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
        <QuickOrderWorkflowTelemetry
          initialTelemetry={workflowTelemetry ?? null}
          refreshIntervalMs={60_000}
          testId="workflow-telemetry-export-card"
        />
      </div>
      {status ? (
        <>
          <dl className="grid gap-3 text-sm text-white/70">
            <div>
              <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Events mirrored</dt>
              <dd className="text-white">{status.events ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Synced</dt>
              <dd className="font-mono text-xs text-white/80">{formatTimestamp(status.syncedAt)}</dd>
            </div>
            {metrics ? (
              <div className="space-y-1">
                <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Funnel snapshot</dt>
                <dd className="text-white">
                  {metrics.startCount ?? "—"} start · {metrics.completeCount ?? "—"} complete ·{" "}
                  {metrics.completionRate !== null && metrics.completionRate !== undefined ? `${metrics.completionRate}%` : "—"} success
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white">
            <a
              href="/api/telemetry/quick-order/export"
              className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white transition hover:border-white/60 hover:text-white"
            >
              Download local NDJSON
            </a>
            <a
              href={proxyDownloadHref}
              className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white/80 transition hover:border-white/60 hover:text-white"
            >
              Download export NDJSON
            </a>
            <a
              href={workflowUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-white/70 transition hover:border-white/60 hover:text-white"
            >
              View workflow
            </a>
          </div>
        </>
      ) : (
        <p className="text-sm text-white/50">
          Export status unavailable. Confirm `QUICK_ORDER_EXPORT_STATUS_URL` points at the JSON snapshot (or run the workflow manually).
          Workflow telemetry will continue to refresh above so Ops can still see the shared guardrail cache.
        </p>
      )}
    </div>
  );
}

function GuardrailAlertsPanel({
  alerts,
  followUpsByProvider,
  conversionCursor,
  conversionHref,
}: GuardrailAlertsPanelProps) {
  const severityTone: Record<GuardrailAlert["severity"], string> = {
    critical: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    warning: "border-amber-400/40 bg-amber-400/10 text-amber-100"
  };

  if (!alerts || alerts.length === 0) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Guardrails</p>
          <h2 className="text-xl font-semibold text-white">Automation alerts</h2>
          <p className="text-sm text-white/60">
            No alerts are open right now. Guardrail monitors will appear here whenever a pricing experiment variant needs attention.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Guardrails</p>
          <h2 className="text-xl font-semibold text-white">Automation alerts</h2>
          <p className="text-sm text-white/60">
            Investigate breached providers quickly—the view links directly to fulfillment automation telemetry.
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">{alerts.length} open alerts</span>
      </header>

      <div className="space-y-3">
        {alerts.map((alert) => {
          const followUps =
            followUpsByProvider[alert.providerId] ?? { entries: [], nextCursor: null, status: null, providerTelemetry: null };
          const latestFollowUp = followUps.entries?.[0] ?? null;
          const isPaused = followUps.status?.isPaused ?? false;
          const platformContextLabel =
            alert.platformContexts && alert.platformContexts.length > 0
              ? formatPlatformContextLabel(alert.platformContexts[0])
              : null;
          return (
            <article key={alert.id} className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Provider</p>
                  <p className="text-lg font-semibold">{alert.providerName}</p>
                  <p className="text-sm text-white/60">{alert.providerId}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isPaused ? (
                    <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-sky-100">
                      Paused
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${severityTone[alert.severity]}`}
                  >
                    {alert.severity === "critical" ? "Critical" : "Warning"}
                  </span>
                </div>
              </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Reasons</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">
                {alert.reasons.map((reason) => (
                  <li key={`${alert.id}-${reason}`}>{reason}</li>
                ))}
              </ul>
            </div>
            {alert.platformContexts?.length ? (
              <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
                {alert.platformContexts.map((context) => (
                  <span
                    key={`${alert.id}-${context.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-sky-100"
                  >
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {formatPlatformContextLabel(context)}
                  </span>
                ))}
              </div>
            ) : null}
            <dl className="grid gap-3 text-xs uppercase tracking-[0.2em] text-white/50 sm:grid-cols-2">
              <div>
                <dt>Guardrail fails</dt>
                <dd className="text-base font-semibold text-white">{alert.guardrailFailures}</dd>
              </div>
              <div>
                <dt>Guardrail warns</dt>
                <dd className="text-base font-semibold text-white">{alert.guardrailWarnings}</dd>
              </div>
              <div>
                <dt>Replay failures</dt>
                <dd className="text-base font-semibold text-white">
                  {alert.replayFailures}
                  {alert.replayTotal > 0 ? ` / ${alert.replayTotal}` : ""}
                </dd>
              </div>
              <div>
                <dt>Detected</dt>
                <dd className="font-mono text-xs text-white/80">{formatTimestamp(alert.detectedAt)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-3 text-xs font-semibold">
              <GuardrailAlertActions
                alert={alert}
                conversionCursor={conversionCursor}
                conversionHref={conversionHref}
              />
              <CopyEscalationSnippetButton
                providerId={alert.providerId}
                providerName={alert.providerName}
                conversionHref={conversionHref}
                conversionCursor={conversionCursor}
                guardrailAction={latestFollowUp?.action ?? null}
                guardrailNotes={latestFollowUp?.notes ?? null}
                followUpHref={alert.automationHref ?? `/admin/fulfillment/providers/${alert.providerId}?tab=automation`}
                platformContextLabel={platformContextLabel}
              />
            </div>
            <GuardrailSlackWorkflowSnippet
              alert={alert}
              followUps={followUps}
              conversionCursor={conversionCursor}
              conversionHref={conversionHref}
              workflowTelemetry={guardrailWorkflowTelemetry ?? null}
            />
            {followUps.providerTelemetry ? (
              <ProviderTelemetryCallout telemetry={followUps.providerTelemetry} />
            ) : null}
            <GuardrailFollowUpTimeline
              providerId={alert.providerId}
              initialEntries={followUps.entries}
              initialNextCursor={followUps.nextCursor}
              defaultOpen={followUps.entries.length > 0}
                emptyState={`No follow-ups logged yet for ${alert.providerName}.`}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

type ProviderTelemetryCalloutProps = {
  telemetry: ProviderAutomationTelemetry;
};

function ProviderTelemetryCallout({ telemetry }: ProviderTelemetryCalloutProps) {
  const guardrail = telemetry.guardrails;
  const replays = telemetry.replays;
  const hotspots = selectProviderGuardrailHotspots(telemetry.guardrailHitsByService);
  const overrideHotspots = selectProviderOverrideHotspots(telemetry.ruleOverridesByService);

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Provider automation telemetry</p>
      <ul className="space-y-1 text-xs text-white/70">
        <li className="flex items-center justify-between gap-2">
          <span>Routed orders</span>
          <span className="font-semibold text-white">{telemetry.totalOrders}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Replays executed</span>
          <span className="font-semibold text-white">
            {replays.executed}/{replays.total} · failed {replays.failed} · scheduled {replays.scheduled}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Guardrail checks</span>
          <span className="font-semibold text-white">
            {guardrail.evaluated}: pass {guardrail.pass} · warn {guardrail.warn} · fail {guardrail.fail}
          </span>
        </li>
        {hotspots.length ? (
          <li>
            Services under watch:{" "}
            {hotspots.map((entry, index) => (
              <span key={entry.id}>
                {entry.label}
                {index < hotspots.length - 1 ? ", " : ""}
              </span>
            ))}
          </li>
        ) : null}
        {overrideHotspots.length ? (
          <li>
            Rule overrides:{" "}
            {overrideHotspots.map((entry, index) => (
              <span key={entry.id}>
                {entry.label}
                {index < overrideHotspots.length - 1 ? ", " : ""}
              </span>
            ))}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function selectProviderGuardrailHotspots(
  map: ProviderAutomationTelemetry["guardrailHitsByService"],
  limit = 3,
): Array<{ id: string; label: string }> {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .filter(([, summary]) => summary.warn > 0 || summary.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail || b[1].warn - a[1].warn)
    .slice(0, limit)
    .map(([key, summary]) => ({
      id: key,
      label: `${key} (warn ${summary.warn}, fail ${summary.fail})`,
    }));
}

function selectProviderOverrideHotspots(
  map: ProviderAutomationTelemetry["ruleOverridesByService"],
  limit = 3,
): Array<{ id: string; label: string }> {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .filter(([, summary]) => summary.totalOverrides > 0)
    .sort((a, b) => b[1].totalOverrides - a[1].totalOverrides)
    .slice(0, limit)
    .map(([key, summary]) => ({
      id: key,
      label: `${key} (${summary.totalOverrides})`,
    }));
}

function summarizeGuardrailAlerts(
  alerts: GuardrailAlert[],
  followUpsByProvider: Record<string, GuardrailFollowUpFeed>
): GuardrailSummary {
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;

  const pausedProviders = new Set<string>();
  let followUpCount = 0;
  for (const [providerId, feed] of Object.entries(followUpsByProvider)) {
    const entries = feed?.entries ?? [];
    followUpCount += entries.length;
    if (feed?.status?.isPaused) {
      pausedProviders.add(providerId);
      continue;
    }
    if (entries.some((entry) => entry.action === "pause")) {
      pausedProviders.add(providerId);
    }
  }

  const pendingCount = alerts.filter((alert) => {
    const feed = followUpsByProvider[alert.providerId];
    const entries = feed?.entries ?? [];
    return entries.length === 0;
  }).length;

  return {
    criticalCount,
    warningCount,
    pausedCount: pausedProviders.size,
    pendingCount,
    followUpCount,
  };
}

function buildGuardrailFollowUpQueue(
  followUpsByProvider: Record<string, GuardrailFollowUpFeed>,
  alerts: GuardrailAlert[]
): GuardrailQueueEntry[] {
  const severityByProvider = new Map<string, GuardrailAlert["severity"]>();
  for (const alert of alerts) {
    const currentSeverity = severityByProvider.get(alert.providerId);
    if (!currentSeverity || currentSeverity === "warning") {
      severityByProvider.set(alert.providerId, alert.severity);
    }
  }

  const entries: GuardrailQueueEntry[] = [];
  for (const [providerId, feed] of Object.entries(followUpsByProvider)) {
    const providerEntries = [...(feed?.entries ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const latestAction = providerEntries[0]?.action ?? null;
    const isPaused = feed?.status ? feed.status.isPaused : latestAction === "pause";
    for (const entry of providerEntries) {
      entries.push({
        providerId,
        providerName: entry.providerName ?? providerId,
        providerHref: `/admin/fulfillment/providers/${providerId}?tab=automation`,
        action: entry.action,
        severity: severityByProvider.get(providerId) ?? "warning",
        isPaused,
        notes: entry.notes ?? null,
        createdAt: entry.createdAt,
        platformContext: entry.platformContext ?? null,
        attachments: entry.attachments ?? null,
        conversionCursor: entry.conversionCursor ?? null,
        conversionHref: entry.conversionHref ?? null,
      });
    }
  }
  return entries
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
}

type ProviderAutomationSnapshotPanelProps = {
  snapshot: ProviderAutomationSnapshot;
};

function ProviderAutomationSnapshotPanel({ snapshot }: ProviderAutomationSnapshotPanelProps) {
  const aggregated = snapshot.aggregated;
  const topProviders = [...snapshot.providers]
    .sort(
      (a, b) =>
        b.telemetry.guardrails.fail - a.telemetry.guardrails.fail ||
        b.telemetry.guardrails.warn - a.telemetry.guardrails.warn
    )
    .slice(0, 5);

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Automation health</p>
          <h2 className="text-xl font-semibold text-white">Provider guardrail snapshot</h2>
          <p className="text-sm text-white/60">
            Live telemetry from `/api/v1/fulfillment/providers/automation/snapshot` summarizing guardrail posture and replay success.
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          {snapshot.providers.length} providers
        </span>
      </header>
      <div className="mt-6 grid gap-4 text-center text-sm text-white/70 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Total orders</p>
          <p className="mt-2 text-2xl font-semibold text-white">{aggregated.totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Guardrail warn/fail</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {aggregated.guardrails.warn} / {aggregated.guardrails.fail}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Replay failures</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {aggregated.replays.failed} / {aggregated.replays.total}
          </p>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-sm text-white/80">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-white/60">
            <tr>
              <th className="px-4 py-2">Provider</th>
              <th className="px-4 py-2 text-right">Orders</th>
              <th className="px-4 py-2 text-right">Guardrail warn/fail</th>
              <th className="px-4 py-2 text-right">Replay failures</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-black/20">
            {topProviders.map((provider) => (
              <tr key={provider.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-white">{provider.name}</div>
                  <p className="text-xs text-white/60">{provider.id}</p>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {provider.telemetry.totalOrders.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {provider.telemetry.guardrails.warn} / {provider.telemetry.guardrails.fail}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {provider.telemetry.replays.failed} / {provider.telemetry.replays.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
