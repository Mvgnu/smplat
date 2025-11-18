import {
  AdminBreadcrumbs,
  AdminTabNav,
} from "@/components/admin";
import Link from "next/link";

import { ADMIN_PRIMARY_TABS } from "@/app/(admin)/admin-tabs";
import { ProviderCatalogClient } from "./ProviderCatalogClient";
import { fetchFulfillmentProviders, fetchProviderOrders } from "@/server/fulfillment/providers";
import { fetchProviderAutomationStatus, fetchProviderAutomationHistory } from "@/server/fulfillment/provider-automation-insights";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import { runAutomationReplayAction, runAutomationAlertAction } from "@/server/actions/provider-automation";
import { fetchBlueprintMetrics, type BlueprintMetrics } from "@/server/reporting/blueprint-metrics";
import { fetchPresetEventAnalytics, type PresetEventAnalytics } from "@/server/analytics/preset-events";
import { fetchGuardrailFollowUps } from "@/server/reporting/guardrail-followups";

// meta: route: admin/fulfillment/providers

const BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Fulfillment", href: "/admin/fulfillment/providers" },
  { label: "Provider catalog" },
];

const PROVIDER_ORDER_INSIGHT_LIMIT = 25;
const integerFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
type PresetProviderWindows = BlueprintMetrics["presetProviderEngagements"]["windows"];
type PresetAlertEntry = PresetEventAnalytics["alerts"][number];
type PresetRiskEntry =
  NonNullable<PresetEventAnalytics["breakdowns"]> extends { riskyPresets: infer T }
    ? T extends Array<infer Item>
      ? Item
      : never
    : never;
type ProviderLoadAlertEntry = BlueprintMetrics["providerLoadAlerts"][number];

export default async function AdminFulfillmentProvidersPage() {
  const [
    providers,
    csrfToken,
    automationStatus,
    automationHistory,
    blueprintMetrics,
    presetEventAnalytics,
  ] = await Promise.all([
    fetchFulfillmentProviders(),
    Promise.resolve(getOrCreateCsrfToken()),
    fetchProviderAutomationStatus().catch(() => null),
    fetchProviderAutomationHistory(10).catch(() => null),
    fetchBlueprintMetrics({ windowDays: 30 }),
    fetchPresetEventAnalytics({ windowDays: 30 }),
  ]);
  const ordersEntries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const orders = await fetchProviderOrders(provider.id, PROVIDER_ORDER_INSIGHT_LIMIT);
        return [provider.id, orders] as const;
      } catch {
        return [provider.id, []] as const;
      }
    }),
  );
  const ordersByProvider = Object.fromEntries(ordersEntries);
  const followUpsEntries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const feed = await fetchGuardrailFollowUps({ providerId: provider.id, limit: 5 });
        return [provider.id, feed] as const;
      } catch {
        return [
          provider.id,
          {
            entries: [],
            nextCursor: null,
          },
        ] as const;
      }
    }),
  );
  const followUpsByProvider = Object.fromEntries(followUpsEntries);
  const providerCohortWindows = blueprintMetrics.presetProviderEngagements.windows;
  const providerLoadAlerts = blueprintMetrics.providerLoadAlerts ?? [];
  const presetAlerts = (presetEventAnalytics.alerts ?? []) as PresetAlertEntry[];
  const riskyPresets = (presetEventAnalytics.breakdowns?.riskyPresets ?? []) as PresetRiskEntry[];

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs items={BREADCRUMBS} trailingAction={<span className="text-xs uppercase tracking-[0.3em] text-white/40">Provider catalog</span>} />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />
      <ProviderCohortAnalyticsSection
        windows={providerCohortWindows}
        loadAlerts={providerLoadAlerts}
        alerts={presetAlerts}
        riskyPresets={riskyPresets}
        generatedAt={blueprintMetrics.presetProviderEngagements.generatedAt}
      />
      <ProviderCatalogClient
        providers={providers}
        ordersByProvider={ordersByProvider}
        followUpsByProvider={followUpsByProvider}
        csrfToken={csrfToken}
        automationStatus={automationStatus}
        automationHistory={automationHistory}
        automationActions={{
          replay: runAutomationReplayAction,
          alerts: runAutomationAlertAction,
          refreshPath: "/admin/fulfillment/providers",
        }}
      />
    </div>
  );
}

type ProviderCohortAnalyticsSectionProps = {
  windows: PresetProviderWindows;
  loadAlerts: ProviderLoadAlertEntry[];
  alerts: PresetAlertEntry[];
  riskyPresets: PresetRiskEntry[];
  generatedAt?: string;
};

function ProviderCohortAnalyticsSection({ windows, loadAlerts, alerts, riskyPresets, generatedAt }: ProviderCohortAnalyticsSectionProps) {
  const orderedWindows: Array<{ key: string; label: string; description: string }> = [
    { key: "7", label: "7-day spike", description: "Short-term surges vs automation capacity." },
    { key: "30", label: "30-day cadence", description: "Primary merchandising pulse used by dashboards." },
    { key: "90", label: "90-day baseline", description: "Historical load to compare against alerts." },
  ];

  return (
    <section className="space-y-5 rounded-3xl border border-white/10 bg-black/20 p-6 text-white">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Provider cohort pulse</p>
          <h2 className="text-lg font-semibold">Preset-driven provider load</h2>
          <p className="text-sm text-white/60">
            Multi-window cohorts highlight which presets are driving automation volume so ops can coordinate with merchandising alerts.
          </p>
        </div>
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">
          Updated{" "}
          {generatedAt
            ? new Date(generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : "—"}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[2.2fr,1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {orderedWindows.map((entry) => (
              <ProviderCohortWindowCard
                key={entry.key}
                label={entry.label}
                description={entry.description}
                window={windows[entry.key]}
              />
            ))}
          </div>
          <ProviderLoadAlertsPanel alerts={loadAlerts} />
        </div>
        <PresetRiskPanel alerts={alerts} riskyPresets={riskyPresets} />
      </div>
    </section>
  );
}

type ProviderCohortWindowCardProps = {
  label: string;
  description: string;
  window?: PresetProviderWindows[string];
};

function ProviderCohortWindowCard({ label, description, window }: ProviderCohortWindowCardProps) {
  const entries = (window?.entries ?? []).slice(0, 4);
  const windowLabel = window ? `${window.days}d · started ${new Date(window.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Window pending";

  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/30 p-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
        <p className="text-sm text-white/60">{description}</p>
      </div>
      <p className="text-xs uppercase tracking-[0.3em] text-white/30">{windowLabel}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-white/50">No provider engagements recorded for this window.</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {entries.map((entry) => {
            const entryKey = `${entry.presetId}-${entry.providerId ?? "provider"}-${entry.serviceId ?? "service"}`;
            const share = Number.isFinite(entry.engagementShare)
              ? percentFormatter.format(entry.engagementShare)
              : "—";
            const amountLabel =
              entry.amountTotal > 0
                ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: entry.currency || "USD",
                    maximumFractionDigits: 0,
                  }).format(entry.amountTotal)
                : null;
            return (
              <li key={entryKey} className="space-y-1 rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    {entry.presetLabel ?? entry.presetId ?? "Preset"}
                  </span>
                  <span className="text-xs uppercase tracking-[0.3em] text-white/50">
                    {integerFormatter.format(entry.engagements)} runs
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  {entry.providerName ?? entry.providerId ?? "Provider"} · {share} of preset load
                </p>
                {amountLabel ? <p className="text-xs text-white/40">{amountLabel} provider spend</p> : null}
                {entry.serviceAction ? (
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/30">{entry.serviceAction}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

type PresetRiskPanelProps = {
  alerts: PresetAlertEntry[];
  riskyPresets: PresetRiskEntry[];
};

function PresetRiskPanel({ alerts, riskyPresets }: PresetRiskPanelProps) {
  return (
    <aside className="space-y-3 rounded-3xl border border-rose-200/30 bg-rose-50/5 p-4 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">Preset risk signals</p>
        <p className="text-sm text-white/70">
          Mirrors merchandising alerts so automation triage keeps merchandising context in view.
        </p>
      </div>
      {alerts.length === 0 && riskyPresets.length === 0 ? (
        <p className="text-sm text-white/60">No preset risk alerts detected in the last 30 days.</p>
      ) : (
        <>
          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.code} className="rounded-2xl border border-rose-200/30 bg-rose-100/5 px-3 py-2 text-sm">
                  <p className="text-xs uppercase tracking-[0.3em] text-rose-200/80">{alert.severity}</p>
                  <p>{alert.message}</p>
                </div>
              ))}
            </div>
          ) : null}
          {riskyPresets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-rose-200/60">Top risky presets</p>
              <ul className="space-y-2 text-sm text-white/80">
                {riskyPresets.slice(0, 3).map((preset) => (
                  <li key={preset.presetId} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                      <span>{preset.presetLabel ?? preset.presetId}</span>
                      <span>{percentFormatter.format(preset.clearRate ?? 0)}</span>
                    </div>
                    <p className="text-white">{integerFormatter.format(preset.net ?? preset.applies ?? 0)} net applies</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <p className="text-xs text-white/40">
        Tip: follow the alert → preset pulse link-in-context to jump into /admin/merchandising for remedial actions.
      </p>
    </aside>
  );
}

type ProviderLoadAlertsPanelProps = {
  alerts: ProviderLoadAlertEntry[];
};

function ProviderLoadAlertsPanel({ alerts }: ProviderLoadAlertsPanelProps) {
  const items = alerts.slice(0, 4);
  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/30 p-4 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Provider load alerts</p>
        <p className="text-sm text-white/60">Presets leaning heavily on a single provider.</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">No cohort imbalances detected in the latest windows.</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {items.map((alert, index) => (
            <li key={`${alert.providerId}-${alert.presetId}-${index}`} className="space-y-1 rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                <span>{alert.providerName ?? alert.providerId}</span>
                <span>{percentFormatter.format(alert.shortShare)}</span>
              </div>
              <p className="text-white">{alert.presetLabel ?? alert.presetId}</p>
              <p className="text-xs text-white/60">
                {alert.shortWindowDays}d vs {alert.longWindowDays}d · Δ {percentFormatter.format(alert.shareDelta)} ·{" "}
                {integerFormatter.format(alert.shortEngagements)} runs
              </p>
              {(alert.links?.merchandising || alert.links?.fulfillment || alert.links?.orders) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {alert.links?.merchandising ? (
                    <Link
                      href={alert.links.merchandising}
                      className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[0.55rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      View preset
                    </Link>
                  ) : null}
                  {alert.links?.fulfillment ? (
                    <Link
                      href={alert.links.fulfillment}
                      className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[0.55rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      View provider
                    </Link>
                  ) : null}
                  {alert.links?.orders ? (
                    <Link
                      href={alert.links.orders}
                      className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-[0.55rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                    >
                      Orders
                    </Link>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
