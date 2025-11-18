import Link from "next/link";

import type {
  ProviderAutomationStatus,
  ProviderAutomationRunStatus,
  ProviderAutomationHistory,
} from "@/types/provider-automation";
import { collectAutoGuardrailActions } from "@/lib/automation-actions";
import { AutoGuardrailActionChip } from "./AutoGuardrailActionChip";
import { extractWorkflowTelemetrySummary } from "@/lib/workflow-telemetry";
import { AutomationWorkflowTelemetry } from "./AutomationWorkflowTelemetry.client";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";

type AutomationStatusPanelProps = {
  status: ProviderAutomationStatus | null;
  history?: ProviderAutomationHistory | null;
  replayAction?: (formData: FormData) => Promise<void>;
  alertAction?: (formData: FormData) => Promise<void>;
  refreshPath?: string;
};

export function AutomationStatusPanel({
  status,
  history,
  replayAction,
  alertAction,
  refreshPath = "/admin/orders",
}: AutomationStatusPanelProps) {
  const replayPrimary = status?.replay ?? history?.replay?.[0] ?? null;
  const replaySummary = replayPrimary?.summary ?? {};
  const backlogValue =
    typeof replaySummary["scheduledBacklog"] === "number" ? (replaySummary["scheduledBacklog"] as number) : null;
  const nextScheduledAt =
    typeof replaySummary["nextScheduledAt"] === "string" ? (replaySummary["nextScheduledAt"] as string) : null;

  const alertPrimary = status?.alerts ?? history?.alerts?.[0] ?? null;
  const alertSummary = (alertPrimary?.summary ?? {}) as Record<string, unknown>;
  const alertDigest = Array.isArray(alertSummary["alertsDigest"])
    ? (alertSummary["alertsDigest"] as Record<string, unknown>[])
    : [];
  const loadAlertsDigest = Array.isArray(alertSummary["loadAlertsDigest"])
    ? (alertSummary["loadAlertsDigest"] as Record<string, unknown>[])
    : [];
  const alertAutoActions =
    collectAutoGuardrailActions(alertPrimary ?? history?.alerts?.[0] ?? null) ?? [];
  const alertWorkflowTelemetry =
    extractWorkflowTelemetrySummary(alertPrimary?.metadata ?? alertPrimary?.summary ?? null) ??
    extractWorkflowTelemetrySummary(history?.alerts?.[0]?.metadata ?? history?.alerts?.[0]?.summary ?? null);

  const entries: Array<{
    label: string;
    data: ProviderAutomationRunStatus | null;
    action?: (formData: FormData) => Promise<void>;
    history?: ProviderAutomationRunStatus[];
  }> = [
    {
      label: "Replay worker",
      data: status?.replay ?? null,
      action: replayAction,
      history: history?.replay ?? [],
    },
    {
      label: "Alert worker",
      data: status?.alerts ?? null,
      action: alertAction,
      history: history?.alerts ?? [],
    },
  ];

  const hasData = entries.some((entry) => entry.data);

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Automation cadence</p>
          <p className="text-sm text-white/60">Latest Celery runs recorded by replay + alert workers.</p>
        </div>
      </div>
      {(backlogValue !== null || nextScheduledAt || alertDigest.length > 0 || loadAlertsDigest.length > 0 || alertAutoActions.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {(backlogValue !== null || nextScheduledAt) && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Replay backlog</p>
              <p className="text-3xl font-semibold text-white">
                {typeof backlogValue === "number" ? backlogValue : "No queue"}
              </p>
              {nextScheduledAt ? (
                <p className="text-sm text-white/60">
                  Next scheduled run{" "}
                  <span className="text-white">{new Date(nextScheduledAt).toLocaleString()}</span>
                </p>
              ) : (
                <p className="text-sm text-white/60">No upcoming scheduled replays.</p>
              )}
            </div>
          )}
          {alertDigest.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Active alerts</p>
              <ul className="mt-2 space-y-2 text-sm text-white/80">
                {alertDigest.slice(0, 3).map((entry, idx) => (
                  <li key={`alert-digest-${idx}`} className="rounded-lg border border-white/10 bg-black/50 p-2">
                    <p className="font-semibold text-white">
                      {(entry.providerName as string) ?? entry.providerId ?? "Provider"}
                    </p>
                    <p className="text-xs text-white/60">
                      {Array.isArray(entry.reasons) && entry.reasons.length
                        ? (entry.reasons as string[]).join(", ")
                        : "Reason not provided"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loadAlertsDigest.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Cohort load alerts</p>
              <ul className="mt-2 space-y-2 text-sm text-white/80">
                {loadAlertsDigest.slice(0, 3).map((entry, idx) => (
                  <li key={`load-alert-${idx}`} className="rounded-lg border border-white/10 bg-black/50 p-2">
                    <p className="font-semibold text-white">
                      {(entry.providerName as string) ?? entry.providerId ?? "Provider"}
                    </p>
                    <p className="text-xs text-white/60">
                      {(entry.presetLabel as string) ?? entry.presetId ?? "Preset"} ·{" "}
                      {typeof entry.shortShare === "number" ? `${Math.round((entry.shortShare as number) * 100)}%` : ""}
                    </p>
                    <AlertLinkRow links={extractDigestLinks(entry.links)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {alertAutoActions.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Auto guardrail actions</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/70">
                {alertAutoActions.slice(0, 4).map((action, index) => (
                  <AutoGuardrailActionChip
                    key={action.followUpId ?? `${action.providerId}-${action.action}-${index}`}
                    action={action}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {hasData ? (
        <div className="grid gap-3 md:grid-cols-2">
          {entries.map((entry) => (
            <AutomationStatusCard
              key={entry.label}
              label={entry.label}
              data={entry.data}
              history={entry.history}
              action={entry.action}
              refreshPath={refreshPath}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/60">No automation runs recorded yet.</p>
      )}
    </div>
  );
}

type DigestLinks = {
  merchandising?: string | null;
  fulfillment?: string | null;
  orders?: string | null;
};

function extractDigestLinks(payload: unknown): DigestLinks {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const source = payload as Record<string, unknown>;
  const normalize = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
  return {
    merchandising: normalize(source.merchandising),
    fulfillment: normalize(source.fulfillment),
    orders: normalize(source.orders),
  };
}

function AlertLinkRow({ links }: { links: DigestLinks }) {
  const { merchandising, fulfillment, orders } = links;
  if (!merchandising && !fulfillment && !orders) {
    return null;
  }
  const linkClass =
    "inline-flex items-center rounded-full border border-white/20 px-2.5 py-1 text-[0.55rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white";
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {merchandising ? (
        <Link href={merchandising} className={linkClass}>
          View preset
        </Link>
      ) : null}
      {fulfillment ? (
        <Link href={fulfillment} className={linkClass}>
          View provider
        </Link>
      ) : null}
      {orders ? (
        <Link href={orders} className={linkClass}>
          Orders
        </Link>
      ) : null}
    </div>
  );
}

function AutomationStatusCard({
  label,
  data,
  history,
  action,
  refreshPath,
}: {
  label: string;
  data: ProviderAutomationRunStatus | null;
  history?: ProviderAutomationRunStatus[];
  action?: (formData: FormData) => Promise<void>;
  refreshPath: string;
}) {
  const timestamp = data ? new Date(data.ranAt) : null;
  const localeString =
    timestamp && !Number.isNaN(timestamp.valueOf()) ? timestamp.toLocaleString() : "No runs recorded";
  const summaryRecord = (data?.summary ?? {}) as Record<string, unknown>;
  const summaryEntries = Object.entries(summaryRecord)
    .filter(
      ([key]) =>
        key !== "alertsDigest" &&
        key !== "loadAlertsDigest" &&
        key !== "loadAlerts" &&
        key !== "autoPausedProviders" &&
        key !== "autoResumedProviders" &&
        key !== "scheduledBacklog" &&
        key !== "nextScheduledAt",
    )
    .slice(0, 4);
  const backlogValue =
    typeof summaryRecord["scheduledBacklog"] === "number"
      ? (summaryRecord["scheduledBacklog"] as number)
      : null;
  const nextScheduledAt =
    typeof summaryRecord["nextScheduledAt"] === "string"
      ? (summaryRecord["nextScheduledAt"] as string)
      : null;
  const workflowTelemetryFallback =
    label === "Alert worker"
      ? extractWorkflowTelemetrySummary(data?.metadata ?? data?.summary ?? null) ??
        extractWorkflowTelemetrySummary(history?.[0]?.metadata ?? history?.[0]?.summary ?? null)
      : null;
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Last run</span>
      </div>
      <p className="text-sm text-white">{localeString}</p>
      <div className="space-y-2">
        {typeof backlogValue === "number" || nextScheduledAt ? (
          <div className="rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-white/70">
            {typeof backlogValue === "number" ? (
              <p>
                Backlog: <span className="text-white">{backlogValue}</span>
              </p>
            ) : null}
            {nextScheduledAt ? (
              <p>
                Next scheduled: <span className="text-white">{new Date(nextScheduledAt).toLocaleString()}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {summaryEntries.length ? (
          <dl className="grid grid-cols-2 gap-2 text-xs text-white/70">
            {summaryEntries.map(([key, value]) => (
              <div key={`${label}-${key}`}>
                <dt className="uppercase tracking-[0.25em] text-white/40">{key}</dt>
                <dd className="text-white">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-white/50">No summary available.</p>
        )}
        {label === "Alert worker" ? (
          <AutomationWorkflowTelemetry initialTelemetry={workflowTelemetryFallback} className="bg-black/20" />
        ) : null}
        {history && history.length ? (
          <div className="space-y-1 text-[0.65rem] text-white/60">
            <p className="uppercase tracking-[0.3em] text-white/30">Recent runs</p>
            <ul className="space-y-1">
              {history.slice(0, 4).map((entry, idx) => {
                const date = new Date(entry.ranAt);
                const labelText = Number.isNaN(date.valueOf()) ? entry.ranAt : date.toLocaleString();
                return (
                  <li key={`${label}-history-${idx}`} className="flex justify-between gap-2 border-b border-white/10 pb-1 last:border-0 last:pb-0">
                    <span>{labelText}</span>
                    <span className="text-white">
                      {Object.entries(entry.summary ?? {})
                        .slice(0, 2)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      {action ? (
        <form action={action} className="text-right">
          <input type="hidden" name="path" value={refreshPath} />
          <button
            type="submit"
            className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Run now
          </button>
        </form>
      ) : null}
    </div>
  );
}
