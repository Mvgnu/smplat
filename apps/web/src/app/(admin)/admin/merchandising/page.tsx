import {
  AdminBreadcrumbs,
  AdminDataTable,
  type AdminDataTableColumn,
  AdminKpiCard,
  AdminTabNav,
} from "@/components/admin";
import Link from "next/link";

import { ADMIN_PRIMARY_TABS } from "@/app/(admin)/admin-tabs";
import { AssetUploadForm } from "./asset-upload-form";
import { BundleDeleteForm } from "./bundle-delete-form";
import { BundleForm } from "./bundle-form";
import { ProductAuditLog } from "./product-audit-log";
import { ProductChannelForm } from "./product-channel-form";
import { ProductStatusForm } from "./product-status-form";
import { OptionMatrixEditor } from "./option-matrix-editor";
import { fetchCatalogBundles } from "@/server/catalog/bundles";
import { fetchProductDetail, fetchProductSummaries } from "@/server/catalog/products";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import { fetchBlueprintMetrics } from "@/server/reporting/blueprint-metrics";
import {
  fetchPresetEventAnalytics,
  type PresetAnalyticsBreakdowns,
  type PresetBreakdownEntry,
  type PresetEventAnalytics,
} from "@/server/analytics/preset-events";

// meta: route: admin/merchandising

type ProductTableRow = {
  id: string;
  title: string;
  status: string;
  channels: string;
  basePrice: string;
  updatedAt: string;
};

const MERCHANDISING_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Merchandising" },
];

const PRODUCT_COLUMNS: AdminDataTableColumn<ProductTableRow>[] = [
  { key: "title", header: "Product" },
  { key: "channels", header: "Channels" },
  { key: "basePrice", header: "Base price" },
  {
    key: "status",
    header: "Status",
    render: (item) => (
      <span className="inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60">
        {item.status}
      </span>
    ),
  },
  { key: "updatedAt", header: "Last updated" },
];

const integerFormatter = new Intl.NumberFormat("en-US");
const decimalPerDayFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type ChangeDescriptor = {
  direction: "up" | "down" | "flat";
  label: string;
};

function computeRunRateDelta(
  recentValue: number,
  recentDays: number,
  baseValue: number,
  baseDays: number,
): number | null {
  if (!Number.isFinite(recentValue) || !Number.isFinite(baseValue) || recentDays <= 0 || baseDays <= 0) {
    return null;
  }
  const recentRate = recentValue / recentDays;
  const baseRate = baseValue / baseDays;
  if (!Number.isFinite(recentRate) || !Number.isFinite(baseRate) || baseRate === 0) {
    return null;
  }
  return recentRate / baseRate - 1;
}

function buildChangeDescriptor(delta: number | null, suffix: string): ChangeDescriptor | undefined {
  if (delta == null || !Number.isFinite(delta)) {
    return undefined;
  }
  const percentage = Math.round(Math.abs(delta * 100));
  if (percentage === 0) {
    return { direction: "flat", label: `~0% ${suffix}` };
  }
  const direction = delta > 0 ? "up" : "down";
  const prefix = delta > 0 ? "+" : "-";
  return { direction, label: `${prefix}${percentage}% ${suffix}` };
}

const sumPresetSelections = (metrics: Awaited<ReturnType<typeof fetchBlueprintMetrics>>): number =>
  metrics.presets.reduce((sum, entry) => sum + entry.selections, 0);

function computeRunRate(value: number, days: number): number | null {
  if (!Number.isFinite(value) || days <= 0) {
    return null;
  }
  return value / days;
}

export default async function AdminMerchandisingPage() {
const [
  products,
  bundles,
  csrfToken,
  blueprintMetrics,
  recentBlueprintMetrics,
  longBlueprintMetrics,
  presetEventAnalytics,
] = await Promise.all([
  fetchProductSummaries(),
  fetchCatalogBundles(),
  Promise.resolve(getOrCreateCsrfToken()),
  fetchBlueprintMetrics({ windowDays: 30 }),
  fetchBlueprintMetrics({ windowDays: 7 }),
  fetchBlueprintMetrics({ windowDays: 90 }),
  fetchPresetEventAnalytics({ windowDays: 30 }),
]);

  const productDetails = await Promise.all(products.map((product) => fetchProductDetail(product.slug)));

  const detailById = new Map(
    productDetails
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
      .map((detail) => [detail.id, detail])
  );

  const liveCount = products.filter((product) => product.status === "active").length;
  const draftCount = products.filter((product) => product.status === "draft").length;
  const archivedCount = products.filter((product) => product.status === "archived").length;
  const channelSet = new Set(products.flatMap((product) => product.channelEligibility));

  const productRows: ProductTableRow[] = products.map((product) => ({
    id: product.id,
    title: product.title,
    status: product.status,
    channels: product.channelEligibility.length
      ? product.channelEligibility.map((channel) => channel.toUpperCase()).join(", ")
      : "—",
    basePrice: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: product.currency,
    }).format(product.basePrice),
    updatedAt: new Date(product.updatedAt).toLocaleString(),
  }));

  const blueprintWindowLabel = `${blueprintMetrics.window.days}-day window`;
  const blueprintWindowStartLabel = new Date(blueprintMetrics.window.start).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const blueprintLongWindowLabel = `${longBlueprintMetrics.window.days}-day baseline`;
  const topPresets = blueprintMetrics.presets.slice(0, 5);
  const topAddOns = blueprintMetrics.addOns.slice(0, 5);
  const topProviders = blueprintMetrics.providerEngagements.slice(0, 5);
  const providerLoadAlerts = blueprintMetrics.providerLoadAlerts.slice(0, 4);
  const providerAutomationHighlight = longBlueprintMetrics.providerEngagements[0];
  const presetSelectionsTotal = blueprintMetrics.presets.reduce((sum, entry) => sum + entry.selections, 0);
  const recentPresetSelections = sumPresetSelections(recentBlueprintMetrics);
  const presetSelectionsChange = buildChangeDescriptor(
    computeRunRateDelta(
      recentPresetSelections,
      recentBlueprintMetrics.window.days,
      presetSelectionsTotal,
      blueprintMetrics.window.days,
    ),
    "7d vs 30d avg",
  );
  const ordersRunRateChange = buildChangeDescriptor(
    computeRunRateDelta(
      recentBlueprintMetrics.orders.total,
      recentBlueprintMetrics.window.days,
      blueprintMetrics.orders.total,
      blueprintMetrics.window.days,
    ),
    "7d vs 30d avg",
  );
  const revenueRunRateChange = buildChangeDescriptor(
    computeRunRateDelta(
      recentBlueprintMetrics.orders.itemRevenue,
      recentBlueprintMetrics.window.days,
      blueprintMetrics.orders.itemRevenue,
      blueprintMetrics.window.days,
    ),
    "7d vs 30d avg",
  );
  const presetTotals = presetEventAnalytics.totals;
  const presetWindowLabel = `${presetEventAnalytics.window.days}-day window`;
  const presetNetApplications =
    presetTotals.preset_cta_apply + presetTotals.preset_configurator_apply - presetTotals.preset_configurator_clear;
  const presetTimeline = presetEventAnalytics.timeline.slice(-10);
  const presetBreakdowns = presetEventAnalytics.breakdowns?.presets ?? [];
  const topPresets = presetBreakdowns.slice(0, 3);
  const riskyPresets =
    presetEventAnalytics.breakdowns?.riskyPresets ??
    presetBreakdowns
      .filter((entry) => entry.clearRate >= 0.4)
      .sort((a, b) => b.clearRate - a.clearRate)
      .slice(0, 3);
  const channelBreakdown = presetEventAnalytics.breakdowns?.sources ?? [];
  const presetAlerts = presetEventAnalytics.alerts ?? [];

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={MERCHANDISING_BREADCRUMBS}
        trailingAction={<span className="text-xs uppercase tracking-[0.3em] text-white/40">Workspace synced</span>}
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard label="Live products" value={liveCount} footer="Publishing to storefront" />
        <AdminKpiCard label="Drafts" value={draftCount} footer="Awaiting review" />
        <AdminKpiCard label="Archived" value={archivedCount} footer="Hidden from operators" />
        <AdminKpiCard label="Channels" value={channelSet.size} footer={Array.from(channelSet).join(", ") || "Unassigned"} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Blueprint analytics</h2>
            <p className="text-sm text-white/60">
              Aggregated storefront presets, add-ons, and provider engagements observed during the{" "}
              {blueprintWindowLabel}.
            </p>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">
            Window start {blueprintWindowStartLabel}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <AdminKpiCard
            label="Orders tracked"
            value={integerFormatter.format(blueprintMetrics.orders.total)}
            footer={`${blueprintWindowLabel} · ${integerFormatter.format(blueprintMetrics.orders.items)} items`}
            change={ordersRunRateChange}
          />
          <AdminKpiCard
            label="Preset selections"
            value={integerFormatter.format(presetSelectionsTotal)}
            footer={`${topPresets.length} unique presets`}
            change={presetSelectionsChange}
          />
          <AdminKpiCard
            label="Item revenue (approx)"
            value={compactCurrencyFormatter.format(blueprintMetrics.orders.itemRevenue)}
            footer="Aggregate across storefront currencies"
            change={revenueRunRateChange}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
<BlueprintTrendSparkline
            label="Order run rate (per day)"
            recentValue={recentBlueprintMetrics.orders.total}
            recentDays={recentBlueprintMetrics.window.days}
            baseValue={blueprintMetrics.orders.total}
            baseDays={blueprintMetrics.window.days}
            longValue={longBlueprintMetrics.orders.total}
            longDays={longBlueprintMetrics.window.days}
          />
<BlueprintTrendSparkline
            label="Preset run rate (per day)"
            recentValue={recentPresetSelections}
            recentDays={recentBlueprintMetrics.window.days}
            baseValue={presetSelectionsTotal}
            baseDays={blueprintMetrics.window.days}
            longValue={longBlueprintMetrics.presets.reduce((sum, entry) => sum + entry.selections, 0)}
            longDays={longBlueprintMetrics.window.days}
          />
<BlueprintTrendSparkline
            label="Revenue run rate (per day)"
            recentValue={recentBlueprintMetrics.orders.itemRevenue}
            recentDays={recentBlueprintMetrics.window.days}
            baseValue={blueprintMetrics.orders.itemRevenue}
            baseDays={blueprintMetrics.window.days}
            longValue={longBlueprintMetrics.orders.itemRevenue}
            longDays={longBlueprintMetrics.window.days}
            format="currency"
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          <BlueprintAnalyticsListCard
            title="Top presets"
            caption="Marketing CTA & configurator applies"
            emptyLabel="No preset interactions yet."
            items={topPresets.map((preset, index) => ({
              id: preset.presetId || `preset-${index}`,
              label: preset.label ?? preset.presetId,
              value: `${integerFormatter.format(preset.selections)} selections`,
              hint: preset.label && preset.label !== preset.presetId ? preset.presetId : undefined,
            }))}
          />
          <BlueprintAnalyticsListCard
            title="Add-on adoption"
            caption="Most frequently bundled add-ons"
            emptyLabel="No add-on data available."
            items={topAddOns.map((addOn, index) => ({
              id: addOn.addOnId || `addon-${index}`,
              label: addOn.label ?? addOn.addOnId ?? "Add-on",
              value: `${integerFormatter.format(addOn.selections)} attaches`,
              hint: addOn.providerName ?? addOn.pricingMode ?? undefined,
            }))}
          />
          <BlueprintAnalyticsListCard
            title="Provider engagements"
            caption="Automation runs by provider/service"
            emptyLabel="No provider engagements yet."
            items={topProviders.map((provider, index) => ({
              id: provider.providerId || `provider-${index}`,
              label: provider.providerName ?? provider.providerId ?? "Provider",
              value: `${integerFormatter.format(provider.engagements)} runs`,
              hint:
                provider.amountTotal > 0
                  ? compactCurrencyFormatter.format(provider.amountTotal)
                  : undefined,
            }))}
          />
          <BlueprintAnalyticsListCard
            title="Cohort load alerts"
            caption="Presets leaning on a single provider"
            emptyLabel="No cohort imbalances detected."
            items={providerLoadAlerts.map((alert, index) => ({
              id: `${alert.providerId}-${alert.presetId}-${index}`,
              label: alert.providerName ?? alert.providerId ?? "Provider",
              value: `${percentFormatter.format(alert.shortShare)} of ${alert.presetLabel ?? alert.presetId}`,
              hint: `${alert.shortWindowDays}d vs ${alert.longWindowDays}d · Δ ${percentFormatter.format(alert.shareDelta)}`,
            }))}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Preset interaction analytics</h2>
            <p className="text-sm text-white/60">
              Captures preset CTA clicks, configurator applies, and clears observed during the {presetWindowLabel}.
            </p>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">
            Window start {new Date(presetEventAnalytics.window.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
        {presetAlerts.length > 0 ? (
          <div className="space-y-2 rounded-3xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            {presetAlerts.map((alert) => (
              <div key={alert.code}>
                <p className="font-semibold uppercase tracking-[0.3em]">{alert.severity === "warn" ? "warning" : "notice"}</p>
                <p>{alert.message}</p>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <AdminKpiCard
            label="CTA applies"
            value={integerFormatter.format(presetTotals.preset_cta_apply)}
            footer="Marketing CTA clicks that seeded the configurator"
          />
          <AdminKpiCard
            label="Configurator applies"
            value={integerFormatter.format(presetTotals.preset_configurator_apply)}
            footer="Preset activations occurring inside the configurator"
          />
          <AdminKpiCard
            label="Net presets"
            value={integerFormatter.format(presetNetApplications)}
            footer={`Clears: ${integerFormatter.format(presetTotals.preset_configurator_clear)}`}
          />
        </div>
        <PresetAnalyticsTimeline entries={presetTimeline} />
        <PresetBreakdownHighlights topPresets={topPresets} riskyPresets={riskyPresets} />
        <PresetSourceBreakdownCard entries={channelBreakdown} />
        <ProviderAutomationRunbookCard
          entry={providerAutomationHighlight}
          windowLabel={blueprintLongWindowLabel}
          windowDays={longBlueprintMetrics.window.days}
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Catalog overview</h2>
          <p className="text-sm text-white/60">
            Update channel eligibility, review publishing status, and attach assets for each product.
          </p>
        </div>
        <AdminDataTable columns={PRODUCT_COLUMNS} data={productRows} rowKey={(row) => row.id} />
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Product controls</h3>
        <div className="grid gap-6 md:grid-cols-2">
          {products.map((product) => {
            const detail = detailById.get(product.id);
            return (
              <div key={product.id} className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-6">
                <header className="space-y-1">
                  <h4 className="text-base font-semibold text-white">{product.title}</h4>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">{product.slug}</p>
                </header>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ProductChannelForm
                    productId={product.id}
                    activeChannels={product.channelEligibility}
                    csrfToken={csrfToken}
                  />
                  <ProductStatusForm
                    productId={product.id}
                    currentStatus={product.status}
                    csrfToken={csrfToken}
                  />
                </div>
              <AssetUploadForm productId={product.id} csrfToken={csrfToken} />
              {detail ? (
                <OptionMatrixEditor product={detail} csrfToken={csrfToken} />
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
                  Configuration editing is unavailable for this product while offline.
                </p>
              )}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/60">
                <h5 className="text-xs uppercase tracking-[0.3em] text-white/40">Assets</h5>
                {detail?.mediaAssets.length ? (
                  <ul className="mt-3 space-y-3">
                    {detail.mediaAssets
                      .slice()
                      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                      .map((asset, index) => (
                        <li key={asset.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">
                                <a
                                  href={asset.assetUrl}
                                  className="hover:text-emerald-300"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {asset.label ?? asset.assetUrl}
                                </a>
                              </p>
                              <p className="text-[0.65rem] text-white/40">
                                storage: {asset.storageKey ?? "—"}
                              </p>
                            </div>
                            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white/60">
                              #{(Number(asset.displayOrder) ?? index) + 1}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {asset.isPrimary ? (
                              <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-emerald-200">
                                Primary
                              </span>
                            ) : null}
                            {(asset.usageTags ?? []).map((tag) => (
                              <span
                                key={`${asset.id}-${tag}`}
                                className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white/60"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 text-[0.65rem] text-white/50">
                            <p>clientId: {asset.clientId ?? "—"}</p>
                            <p>checksum: {asset.checksum ?? "—"}</p>
                            {asset.altText ? <p>alt text: {asset.altText}</p> : null}
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-2">No assets uploaded.</p>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h5 className="text-xs uppercase tracking-[0.3em] text-white/40">Audit log</h5>
                <ProductAuditLog entries={detail?.auditLog ?? []} csrfToken={csrfToken} />
              </div>
            </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-white">Catalog bundles</h3>
          <p className="text-sm text-white/60">
            Configure deterministic bundles powering storefront recommendations. Components accept product slugs.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {bundles.length === 0 ? (
              <p className="text-sm text-white/60">No bundles published yet.</p>
            ) : (
              <ul className="space-y-4">
                {bundles.map((bundle) => (
                  <li key={bundle.id} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">{bundle.bundleSlug}</span>
                      <h4 className="text-base font-semibold text-white">{bundle.title}</h4>
                      <p className="text-sm text-white/60">{bundle.description ?? "No description provided."}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
                      {bundle.components.map((component) => (
                        <span key={component.slug} className="rounded-full border border-white/10 px-3 py-1 uppercase tracking-[0.2em]">
                          {component.slug}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-white/40">
                      <span>Priority {bundle.cmsPriority}</span>
                      <BundleDeleteForm bundleId={bundle.id} csrfToken={csrfToken} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <BundleForm
            csrfToken={csrfToken}
            bundle={
              bundles[0]
                ? {
                    id: bundles[0].id,
                    primaryProductSlug: bundles[0].primaryProductSlug,
                    bundleSlug: bundles[0].bundleSlug,
                    title: bundles[0].title,
                    description: bundles[0].description ?? null,
                    savingsCopy: bundles[0].savingsCopy ?? null,
                    cmsPriority: bundles[0].cmsPriority,
                    components: bundles[0].components.map((component) => component.slug),
                  }
                : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}

type BlueprintAnalyticsListCardProps = {
  title: string;
  caption: string;
  items: Array<{
    id: string;
    label: string | null | undefined;
    value: string;
    hint?: string | null;
  }>;
  emptyLabel: string;
};

function BlueprintAnalyticsListCard({ title, caption, items, emptyLabel }: BlueprintAnalyticsListCardProps) {
  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-5 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">{title}</p>
        <p className="text-sm text-white/60">{caption}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{item.label ?? "—"}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-white/50">{item.value}</span>
              </div>
              {item.hint ? <p className="text-xs text-white/50">{item.hint}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

type BlueprintTrendSparklineProps = {
  label: string;
  recentValue: number;
  recentDays: number;
  baseValue: number;
  baseDays: number;
  longValue?: number;
  longDays?: number;
  format?: "number" | "currency";
};

function BlueprintTrendSparkline({
  label,
  recentValue,
  recentDays,
  baseValue,
  baseDays,
  longValue,
  longDays,
  format = "number",
}: BlueprintTrendSparklineProps) {
  const recentRate = computeRunRate(recentValue, recentDays);
  const baseRate = computeRunRate(baseValue, baseDays);
  const longRate =
    typeof longValue === "number" && typeof longDays === "number" ? computeRunRate(longValue, longDays) : null;
  const ratio =
    recentRate != null && baseRate != null
      ? baseRate === 0
        ? recentRate > 0
          ? 2
          : 0
        : recentRate / baseRate
      : null;
  const normalized = ratio != null ? Math.max(-1, Math.min(ratio - 1, 1)) : null;
  const fillPercent = normalized != null ? 50 + normalized * 50 : 0;
  const formatter =
    format === "currency"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const displayValue =
    recentRate != null
      ? formatter.format(recentRate)
      : format === "currency"
        ? "$0.00"
        : "0";

  return (
    <article className="space-y-2 rounded-3xl border border-white/10 bg-black/20 p-4 text-white">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
        <span>{label}</span>
        <span className="text-white/70">{displayValue}</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 w-full rounded-full bg-white/5" />
        <div
          className={`relative h-full rounded-full ${
            normalized != null
              ? normalized >= 0
                ? "bg-emerald-400/80"
                : "bg-rose-400/70"
              : "bg-white/20"
          }`}
          style={{ width: `${Math.max(0, Math.min(fillPercent, 100))}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
      </div>
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
        7d vs {baseDays}d parity
        {longRate != null ? ` • ${longDays}d avg ${formatter.format(longRate)}` : ""}
      </p>
    </article>
  );
}

type PresetTimelineEntry = PresetEventAnalytics["timeline"][number];

type PresetAnalyticsTimelineProps = {
  entries: PresetTimelineEntry[];
};

function PresetAnalyticsTimeline({ entries }: PresetAnalyticsTimelineProps) {
  const latestTrend = entries.at(-1)?.trend;
  const rollingAvg = latestTrend?.applyAvg7 ?? entries.at(-1)?.totals.applies ?? 0;
  const clearRate = latestTrend?.clearRate7 ?? entries.at(-1)?.totals.clearRate ?? 0;
  return (
    <article className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5 text-white">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Daily preset interactions</p>
        <p className="text-sm text-white/60">
          {entries.length > 0
            ? `Rolling avg ${decimalPerDayFormatter.format(rollingAvg)} applies/day · Clear rate ${
                percentFormatter.format(clearRate)
              }`
            : "Waiting for the first preset interactions."}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-white/50">No preset telemetry recorded yet.</p>
      ) : (
        <>
          <PresetSparkline entries={entries} />
          <ul className="space-y-2 text-sm text-white/80">
            {entries.map((entry) => {
              const { presetCtaApply, presetConfiguratorApply, presetConfiguratorClear } = entry.counts;
              const total = entry.totals.total;
              const ctaWidth = total > 0 ? Math.round((presetCtaApply / total) * 100) : 0;
              const applyWidth = total > 0 ? Math.round((presetConfiguratorApply / total) * 100) : 0;
              const clearWidth = Math.max(0, 100 - ctaWidth - applyWidth);
              return (
                <li key={entry.date} className="space-y-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                    <span>{entry.date}</span>
                    <span className="text-white/70">{integerFormatter.format(total)} total</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full">
                    <div className="h-full bg-emerald-400/70" style={{ width: `${ctaWidth}%` }} />
                    <div className="h-full bg-sky-400/70" style={{ width: `${applyWidth}%` }} />
                    <div className="h-full bg-rose-400/70" style={{ width: `${clearWidth}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-white/60">
                    <span>CTA {presetCtaApply}</span>
                    <span>Configurator {presetConfiguratorApply}</span>
                    <span>Clears {presetConfiguratorClear}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}

type PresetSparklineProps = {
  entries: PresetTimelineEntry[];
};

function PresetSparkline({ entries }: PresetSparklineProps) {
  const appliesValues = entries.map((entry) => entry.totals.applies);
  const clearsValues = entries.map((entry) => entry.totals.clears);
  const maxValue = Math.max(...appliesValues, ...clearsValues, 1);
  const resolution = Math.max(entries.length - 1, 1);

  const buildPoints = (values: number[]) =>
    values
      .map((value, index) => {
        const x = resolution === 0 ? 0 : (index / resolution) * 100;
        const y = 40 - (value / maxValue) * 40;
        return `${x},${y}`;
      })
      .join(" ");

  const appliesPoints = buildPoints(appliesValues);
  const clearsPoints = buildPoints(clearsValues);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
        <span>Applies vs clears</span>
        <div className="flex items-center gap-3 text-[0.65rem] text-white/70">
          <span className="flex items-center gap-1">
            <span className="h-1 w-4 rounded-full bg-emerald-300/80" />
            Applies
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1 w-4 rounded-full bg-rose-300/80" />
            Clears
          </span>
        </div>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-24 w-full">
        <polyline
          fill="none"
          stroke="rgba(16,185,129,0.85)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={appliesPoints}
        />
        <polyline
          fill="none"
          stroke="rgba(244,114,182,0.85)"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={clearsPoints}
        />
      </svg>
    </div>
  );
}

type PresetBreakdownHighlightsProps = {
  topPresets: PresetBreakdownEntry[];
  riskyPresets: PresetBreakdownEntry[];
};

function PresetBreakdownHighlights({ topPresets, riskyPresets }: PresetBreakdownHighlightsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PresetBreakdownCard
        title="Top presets"
        caption="Highest apply volume over the selected window."
        emptyLabel="No presets have been applied yet."
        items={topPresets.map((entry) => {
          const longStats = entry.windows?.long ?? { applies: entry.applies, clears: entry.clears, net: entry.net, clearRate: entry.clearRate };
          const shortStats = entry.windows?.short ?? longStats;
          return {
            id: entry.presetId,
            label: entry.presetLabel ?? entry.presetId,
            metrics: [
              `7d ${integerFormatter.format(shortStats.applies)} applies`,
              `30d ${integerFormatter.format(longStats.applies)} applies`,
              `Net ${integerFormatter.format(longStats.net)}`,
            ],
            isRisky: entry.isRisky,
            riskReason: entry.riskReason ?? undefined,
          };
        })}
      />
      <PresetBreakdownCard
        title="Risky presets"
        caption="High clear-rate presets need follow-up."
        emptyLabel="No presets are at risk."
        items={riskyPresets.map((entry) => {
          const longStats = entry.windows?.long ?? { applies: entry.applies, clears: entry.clears, net: entry.net, clearRate: entry.clearRate };
          const shortStats = entry.windows?.short ?? longStats;
          return {
            id: entry.presetId,
            label: entry.presetLabel ?? entry.presetId,
            metrics: [
              `7d clear rate ${percentFormatter.format(shortStats.clearRate)}`,
              `30d clear rate ${percentFormatter.format(longStats.clearRate)}`,
              `${integerFormatter.format(longStats.applies)} applies`,
            ],
            isRisky: true,
            riskReason: entry.riskReason ?? "High clear rate",
          };
        })}
      />
    </div>
  );
}

type PresetBreakdownCardItem = {
  id: string;
  label: string;
  metrics: string[];
  isRisky?: boolean;
  riskReason?: string;
};

type PresetBreakdownCardProps = {
  title: string;
  caption: string;
  items: PresetBreakdownCardItem[];
  emptyLabel: string;
};

function PresetBreakdownCard({ title, caption, items, emptyLabel }: PresetBreakdownCardProps) {
  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-5 text-white">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">{caption}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {items.map((item) => (
            <li key={item.id} className="space-y-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">{item.label}</span>
                <div className="flex items-center gap-2">
                  {item.isRisky ? (
                    <span className="rounded-full border border-rose-400/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.2em] text-rose-200/90">
                      Risk
                    </span>
                  ) : null}
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Preset</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-white/60">
                {item.metrics.map((metric) => (
                  <span key={metric}>{metric}</span>
                ))}
                {item.isRisky && item.riskReason ? (
                  <span className="text-rose-200/80">{item.riskReason}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

type PresetSourceBreakdownCardProps = {
  entries: (PresetAnalyticsBreakdowns["sources"][number])[];
};

function PresetSourceBreakdownCard({ entries }: PresetSourceBreakdownCardProps) {
  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-5 text-white">
      <div>
        <p className="text-sm font-semibold text-white">Channel cohorts</p>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">CTA + configurator sources</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-white/50">No channel telemetry recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {entries.map((entry) => {
            const longStats = entry.windows?.long ?? {
              applies: entry.applies,
              clears: entry.clears,
              net: entry.net,
              clearRate: entry.clearRate,
            };
            const shortStats = entry.windows?.short ?? longStats;
            return (
              <li
                key={entry.source}
                className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="text-white font-medium">{entry.source}</p>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Channel</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-white/60">
                  <span>7d {integerFormatter.format(shortStats.applies)} applies</span>
                  <span>30d {integerFormatter.format(longStats.applies)} applies</span>
                  <span>Net {integerFormatter.format(longStats.net)}</span>
                  <span>30d clear rate {percentFormatter.format(longStats.clearRate)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

type ProviderAutomationRunbookCardProps = {
  entry: BlueprintProviderMetric | undefined;
  windowLabel: string;
  windowDays: number;
};

function ProviderAutomationRunbookCard({ entry, windowLabel, windowDays }: ProviderAutomationRunbookCardProps) {
  return (
    <article className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-5 text-white">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Provider automation pulse</p>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">{windowLabel}</p>
        </div>
        <Link
          href="/admin/fulfillment/providers"
          className="rounded-full border border-white/30 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/80 hover:bg-white/10"
        >
          Review
        </Link>
      </div>
      {entry ? (
        <>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-base font-semibold text-white">{entry.providerName ?? "Provider"}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">
              {entry.serviceAction ?? entry.serviceId ?? "Service"}
            </p>
            <dl className="mt-3 grid gap-2 text-sm text-white/80 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Engagements</dt>
                <dd>{integerFormatter.format(entry.engagements)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Amount processed</dt>
                <dd>${integerFormatter.format(Math.round(entry.amountTotal))}</dd>
              </div>
            </dl>
          </div>
          <p className="text-xs text-white/60">
            Keep this service within guardrails—run provider automation status or replay jobs if engagements spike.
          </p>
        </>
      ) : (
        <p className="text-sm text-white/60">
          No provider engagements recorded in the last {windowDays} days. Automation signals will appear here once
          fulfillment traffic resumes.
        </p>
      )}
    </article>
  );
}
  const longOrdersRunRate = computeRunRate(longBlueprintMetrics.orders.total, longBlueprintMetrics.window.days);
  const longPresetRunRate = computeRunRate(
    longBlueprintMetrics.presets.reduce((sum, entry) => sum + entry.selections, 0),
    longBlueprintMetrics.window.days,
  );
  const longRevenueRunRate = computeRunRate(
    longBlueprintMetrics.orders.itemRevenue,
    longBlueprintMetrics.window.days,
  );
