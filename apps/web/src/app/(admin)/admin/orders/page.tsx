import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminBreadcrumbs,
  AdminKpiCard,
  AdminTabNav
} from "@/components/admin";
import { CopyReceiptLinkButton } from "@/components/orders/copy-receipt-link-button";
import { buildOrderJsonDownloadHref, getOrderDownloadFilename } from "@/lib/orders/receipt-exports";
import { formatAppliedAddOnLabel } from "@/lib/product-pricing";
import { describeRuleConditions, describeRuleOverrides } from "@/lib/provider-rule-descriptions";
import { ProviderOrderCard } from "../fulfillment/providers/ProviderOrderCard";
import type { FulfillmentProviderOrder } from "@/types/fulfillment";
import {
  fetchProviderAutomationSnapshot,
  fetchProviderAutomationStatus,
  fetchProviderAutomationHistory,
  type ProviderAutomationSnapshot
} from "@/server/fulfillment/provider-automation-insights";
import { fetchAdminOrder, fetchAdminOrders } from "@/server/orders/admin-orders";
import { fetchOrderProgress } from "@/server/orders/progress";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import type { MarginStatus, ProviderAutomationTelemetry, RuleOverrideServiceSummary } from "@/lib/provider-service-insights";
import { summarizeProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { ProviderAutomationStatus, ProviderAutomationHistory } from "@/types/provider-automation";
import { AutomationStatusPanel } from "@/components/admin/AutomationStatusPanel";
import { runAutomationReplayAction, runAutomationAlertAction } from "@/server/actions/provider-automation";
import { fetchBlueprintMetrics, type ProviderLoadAlert } from "@/server/reporting/blueprint-metrics";

import { ADMIN_PRIMARY_TABS } from "../../admin-tabs";
import { OrderStatusFilters } from "./status-filter";
import { OrderStatusForm } from "./status-form";
import { JourneyAutomationForm } from "./journey-automation-form";
import { OrdersTable } from "./orders-table.client";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  ORDER_DATE_TIME_FORMATTER,
  formatOrderCurrency
} from "./order-presenters";

type AdminOrdersPageProps = {
  searchParams?: {
    orderId?: string;
    status?: string;
  };
};

type OrderSummary = Awaited<ReturnType<typeof fetchAdminOrders>>[number];

export const metadata: Metadata = {
  title: "Orders"
};

const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

const ORDER_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Orders" }
];

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const [orders, automationSnapshot, automationStatus, automationHistory, blueprintMetrics] = await Promise.all([
    fetchAdminOrders(50),
    fetchProviderAutomationSnapshot(20).catch(() => null),
    fetchProviderAutomationStatus().catch(() => null),
    fetchProviderAutomationHistory(10).catch(() => null),
    fetchBlueprintMetrics({ windowDays: 30 })
  ]);
  const csrfToken = getOrCreateCsrfToken();
  const automationServiceInsights =
    automationSnapshot && automationSnapshot.providers.length
      ? buildAutomationServiceInsights(automationSnapshot.providers)
      : [];
  const providerLoadAlerts = blueprintMetrics.providerLoadAlerts.slice(0, 4);

  if (orders.length === 0) {
    return (
      <div className="space-y-8">
        <AdminBreadcrumbs items={ORDER_BREADCRUMBS} />
        <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />
        <section className="flex min-h-[18rem] flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-12 text-center text-white/60 backdrop-blur">
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">Operations</p>
          <h1 className="text-3xl font-semibold text-white">Orders</h1>
          <p className="max-w-xl text-sm text-white/70">
            Track every checkout and monitor fulfillment milestones in a single operations surface.
          </p>
          <p>No orders yet. As soon as customers complete checkout, new orders will appear here.</p>
        </section>
      </div>
    );
  }

  const statusFilter = searchParams?.status ?? "all";
  const filteredOrders =
    statusFilter && statusFilter !== "all" ? orders.filter((order) => order.status === statusFilter) : orders;

  const totalVolume = orders.reduce((sum, order) => sum + order.total, 0);
  const currency = orders[0]?.currency ?? "USD";
  const processingCount = orders.filter((order) => order.status === "processing").length;
  const atRiskCount = orders.filter((order) => order.status === "on_hold" || order.status === "pending").length;
  const completedCount = orders.filter((order) => order.status === "completed").length;

  const requestedOrderId = searchParams?.orderId ?? null;
  let selectedOrderId =
    requestedOrderId && orders.some((order) => order.id === requestedOrderId)
      ? requestedOrderId
      : filteredOrders[0]?.id ?? orders[0]?.id ?? null;

  const selectedOrder = selectedOrderId ? await fetchAdminOrder(selectedOrderId) : null;
  if (!selectedOrder && filteredOrders.length > 0) {
    selectedOrderId = filteredOrders[0].id;
  }

  const effectiveOrder = selectedOrder ?? (selectedOrderId ? await fetchAdminOrder(selectedOrderId) : null);
  const progress = effectiveOrder ? await fetchOrderProgress(effectiveOrder.id) : null;
  const downloadHref = effectiveOrder ? buildOrderJsonDownloadHref(effectiveOrder) : null;
  const downloadFilename = effectiveOrder ? getOrderDownloadFilename(effectiveOrder) : null;
  const providerOrders = (effectiveOrder?.providerOrders ?? []) as FulfillmentProviderOrder[];
  const providerTelemetry = providerOrders.length ? summarizeProviderAutomationTelemetry(providerOrders) : null;
  const journeyProducts =
    effectiveOrder?.items
      .filter((item) => item.productId)
      .map((item) => ({ id: item.productId as string, title: item.productTitle })) ?? [];

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={ORDER_BREADCRUMBS}
        trailingAction={
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Audit trail logging active</span>
        }
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard label="Total orders" value={orders.length} />
        <AdminKpiCard label="Processing" value={processingCount} change={{ direction: "flat", label: "Live" }} />
        <AdminKpiCard label="At risk" value={atRiskCount} change={{ direction: atRiskCount > 0 ? "up" : "flat", label: atRiskCount > 0 ? "+Guard" : "Stable" }} />
        <AdminKpiCard
          label="Volume (30d)"
          value={formatOrderCurrency(totalVolume, currency)}
          footer={`${completedCount} completed`}
        />
      </section>

      {automationSnapshot ? (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Provider automation insights</h2>
            <p className="text-sm text-white/60">
              Replay cadence, pending scheduled runs, and guardrail posture aggregated across the provider catalog.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Provider orders", value: automationSnapshot.aggregated.totalOrders },
              { label: "Replays executed", value: automationSnapshot.aggregated.replays.executed },
              { label: "Replays failed", value: automationSnapshot.aggregated.replays.failed },
              { label: "Scheduled pending", value: automationSnapshot.aggregated.replays.scheduled }
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["fail", "warn", "pass"] as const).map((status) => {
              const tone = getMarginStatusStyle(status);
              const value = automationSnapshot.aggregated.guardrails[status];
              return (
                <span
                  key={status}
                  className={`rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${tone.border} ${tone.text}`}
                >
                  {tone.label}: {value}
                </span>
              );
            })}
          </div>
          <ProviderLoadAlertsCallout alerts={providerLoadAlerts} />
          {automationSnapshot.providers.length ? (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Top providers by guardrail alerts</p>
              <div className="grid gap-2 md:grid-cols-2">
                {automationSnapshot.providers
                  .map((entry) => ({
                    ...entry,
                    riskScore: entry.telemetry.guardrails.fail * 2 + entry.telemetry.guardrails.warn
                  }))
                  .sort((a, b) => b.riskScore - a.riskScore)
                  .slice(0, 4)
                  .map((entry) => {
                    const breaches = entry.telemetry.guardrails.fail;
                    const warnings = entry.telemetry.guardrails.warn;
                    return (
                      <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">{entry.name}</span>
                          <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                            {entry.telemetry.totalOrders} orders
                          </span>
                        </div>
                        <p className="text-xs text-white/60">
                          {breaches} breaches · {warnings} warnings · {entry.telemetry.replays.failed} failed replays
                        </p>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : null}
          {automationServiceInsights.length ? (
            <AutomationServiceInsights entries={automationServiceInsights.slice(0, 4)} />
          ) : null}
        </section>
      ) : null}

      <AutomationStatusPanel
        status={automationStatus ?? null}
        history={automationHistory ?? null}
        replayAction={runAutomationReplayAction}
        alertAction={runAutomationAlertAction}
        refreshPath="/admin/orders"
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Order queue</h2>
            <p className="text-sm text-white/50">Monitor new intents and prioritize fulfillment operations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OrderStatusFilters />
            <a
              href="/api/orders/export?limit=100"
              className="inline-flex items-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Download export
            </a>
          </div>
        </div>
        <OrdersTable orders={filteredOrders} />
      </section>

      {effectiveOrder ? (
        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Order number</p>
              <h2 className="text-2xl font-semibold text-white">{effectiveOrder.orderNumber}</h2>
            </div>
            <div className="flex flex-col items-start gap-3 text-xs text-white/60 md:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                    ORDER_STATUS_TONE[effectiveOrder.status] ?? "bg-white/10 text-white/70 border border-white/20"
                  }`}
                >
                  {ORDER_STATUS_LABELS[effectiveOrder.status] ?? effectiveOrder.status}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-white/60">
                  Updated {ORDER_DATE_TIME_FORMATTER.format(new Date(effectiveOrder.updatedAt))}
                </span>
              </div>
              {downloadHref && downloadFilename ? (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <CopyReceiptLinkButton orderId={effectiveOrder.id} orderNumber={effectiveOrder.orderNumber} />
                  <a
                    href={downloadHref}
                    download={downloadFilename}
                    className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                  >
                    Download JSON
                  </a>
                </div>
              ) : null}
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminKpiCard label="Total" value={formatOrderCurrency(effectiveOrder.total, effectiveOrder.currency)} />
            <AdminKpiCard
              label="Progress"
              value={progress ? `${progress.completedSteps}/${progress.totalSteps}` : "—"}
              footer={progress ? `Next: ${progress.nextStep ?? "Review"}` : "Awaiting update"}
            />
          </div>

          <OrderStatusForm orderId={effectiveOrder.id} currentStatus={effectiveOrder.status} csrfToken={csrfToken} />
          <JourneyAutomationForm orderId={effectiveOrder.id} products={journeyProducts} csrfToken={csrfToken} />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Items</h3>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
              {effectiveOrder.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-white">{item.productTitle}</span>
                    <span className="text-white/70">{formatOrderCurrency(item.totalPrice, effectiveOrder.currency)}</span>
                  </div>
                  <div className="text-xs text-white/50">
                    {item.quantity} × {formatOrderCurrency(item.unitPrice, effectiveOrder.currency)}
                  </div>
                  {item.selectedOptions?.options?.length ? (
                    <div className="mt-3 space-y-2 text-xs text-white/60">
                      <p className="uppercase tracking-wide text-white/40">Blueprint options</p>
                      <ul className="space-y-2">
                        {item.selectedOptions.options.map((selection) => {
                          const deltaLabel =
                            selection.priceDelta !== 0
                              ? `${selection.priceDelta > 0 ? "+" : "-"}${formatOrderCurrency(
                                  Math.abs(selection.priceDelta),
                                  effectiveOrder.currency
                                )}`
                              : "included";
                          return (
                            <li
                              key={`${selection.groupId}-${selection.optionId}`}
                              className="space-y-1 rounded-xl border border-white/10 bg-black/30 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-white">{selection.groupName}</p>
                                  <p className="text-sm text-white/70">{selection.label}</p>
                                </div>
                                <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                                  {deltaLabel}
                                </span>
                              </div>
                              {selection.marketingTagline ? (
                                <p className="text-sm text-white/70">{selection.marketingTagline}</p>
                              ) : null}
                              {selection.fulfillmentSla ? (
                                <p className="text-xs text-white/50">SLA: {selection.fulfillmentSla}</p>
                              ) : null}
                              {selection.heroImageUrl ? (
                                <p className="truncate text-[0.65rem] text-white/40">
                                  Hero asset: {selection.heroImageUrl}
                                </p>
                              ) : null}
                              {selection.calculator ? (
                                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[0.65rem] text-white/60">
                                  <p className="uppercase tracking-[0.3em] text-white/40">Calculator</p>
                                  <code className="block text-sm text-white/70">{selection.calculator.expression}</code>
                                  {selection.calculator.sampleResult != null ? (
                                    <p className="mt-1">
                                      Sample {selection.calculator.sampleResult.toFixed(2)} — amount{" "}
                                      {selection.calculator.sampleAmount ?? "–"}, days{" "}
                                      {selection.calculator.sampleDays ?? "–"}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-white/40">Awaiting sample inputs</p>
                                  )}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {item.selectedOptions?.addOns?.length ? (
                    <div className="mt-3 space-y-2 text-xs text-white/60">
                      <p className="uppercase tracking-wide text-white/40">Add-ons</p>
                      <ul className="space-y-2">
                        {item.selectedOptions.addOns.map((addOn) => {
                          const labels = formatAppliedAddOnLabel(
                            {
                              mode: addOn.pricingMode,
                              amount: addOn.pricingAmount ?? null,
                              serviceId: addOn.serviceId ?? null,
                              serviceProviderName: addOn.serviceProviderName ?? null,
                              serviceAction: addOn.serviceAction ?? null,
                              serviceDescriptor: addOn.serviceDescriptor ?? null,
                              previewQuantity: addOn.previewQuantity ?? null,
                            },
                            addOn.priceDelta,
                            effectiveOrder.currency,
                          );
                          return (
                            <li key={addOn.id} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-white/80">{addOn.label}</span>
                                <span className="text-white/70">
                                  {labels.primary}
                                  {labels.secondary ? ` (${labels.secondary})` : ""}
                                </span>
                              </div>
                              {addOn.previewQuantity != null || addOn.payloadTemplate ? (
                                <div className="mt-2 space-y-1 text-[0.65rem] text-white/60">
                                  {addOn.previewQuantity != null ? (
                                    <p>Preview quantity: {addOn.previewQuantity}</p>
                                  ) : null}
                              {addOn.payloadTemplate ? (
                                <pre className="overflow-auto rounded border border-white/10 bg-black/30 px-2 py-1 text-[0.6rem] text-white/50">
                                  {JSON.stringify(addOn.payloadTemplate, null, 2)}
                                </pre>
                              ) : null}
                            </div>
                          ) : null}
                          {addOn.serviceRules && addOn.serviceRules.length > 0 ? (
                            <div className="mt-2 space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[0.65rem] text-emerald-100">
                              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-emerald-300/80">
                                Provider rules
                              </p>
                              <ul className="space-y-2 text-emerald-50">
                                {addOn.serviceRules.map((rule) => (
                                  <li key={rule.id} className="space-y-1 rounded border border-emerald-400/20 bg-black/10 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-emerald-100">
                                        {rule.label ?? rule.id}
                                      </span>
                                      {rule.priority != null ? (
                                        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-emerald-300/70">
                                          Priority {rule.priority}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="text-emerald-200">
                                      Conditions: {describeRuleConditions(rule)}
                                    </p>
                                    <p className="text-emerald-200/80">
                                      Overrides: {describeRuleOverrides(rule)}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                  ) : null}
                  {item.selectedOptions?.subscriptionPlan ? (
                    <div className="mt-3 space-y-1 text-xs text-white/60">
                      <p className="uppercase tracking-wide text-white/40">Subscription plan</p>
                      <p className="text-sm text-white/70">{item.selectedOptions.subscriptionPlan.label}</p>
                      <p>
                        Cycle: {item.selectedOptions.subscriptionPlan.billingCycle}
                        {item.selectedOptions.subscriptionPlan.priceMultiplier != null
                          ? ` · multiplier ${item.selectedOptions.subscriptionPlan.priceMultiplier.toFixed(2)}`
                          : ""}
                        {item.selectedOptions.subscriptionPlan.priceDelta != null
                          ? ` · delta ${formatOrderCurrency(
                              item.selectedOptions.subscriptionPlan.priceDelta,
                              effectiveOrder.currency
                            )}`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  {item.selectedOptions ? (
                    <details className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/50">
                      <summary className="cursor-pointer text-white/70">Raw selection payload</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-white/60">
                        {JSON.stringify(item.selectedOptions, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {providerOrders.length ? (
            <section className="space-y-3" data-testid="admin-provider-automation">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Provider automation</h3>
              {providerTelemetry ? (
                <ProviderAutomationSummary telemetry={providerTelemetry} orders={providerOrders} />
              ) : null}
              <div className="space-y-3">
                {providerOrders.map((providerOrder) => (
                  <ProviderOrderCard
                    key={providerOrder.id}
                    providerId={providerOrder.providerId}
                    order={providerOrder}
                    csrfToken={csrfToken}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {progress && progress.steps.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Fulfillment milestones</h3>
              <ol className="space-y-2 text-sm text-white/70">
                {progress.steps.map((step) => (
                  <li key={step.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                    <span>{step.name}</span>
                    <span className={`text-xs uppercase tracking-[0.3em] ${
                      step.completed ? "text-emerald-300" : "text-white/40"
                    }`}>
                      {step.completed ? "Completed" : "Pending"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-white/60">
          Select an order from the queue to review fulfillment history.
        </section>
      )}
    </div>
  );
}

function ProviderAutomationSummary({
  telemetry,
  orders
}: {
  telemetry: ProviderAutomationTelemetry;
  orders: FulfillmentProviderOrder[];
}) {
  const summaryStats = [
    { label: "Provider orders", value: telemetry.totalOrders },
    { label: "Replays executed", value: telemetry.replays.executed },
    { label: "Replays failed", value: telemetry.replays.failed },
    { label: "Scheduled pending", value: telemetry.replays.scheduled }
  ];
  const guardrailStats: Array<{ label: string; value: number; status: MarginStatus }> = [
    { label: "Guardrail failures", value: telemetry.guardrails.fail, status: "fail" },
    { label: "Warnings", value: telemetry.guardrails.warn, status: "warn" },
    { label: "Passes", value: telemetry.guardrails.pass, status: "pass" }
  ];
  const serviceInsights = buildOrderServiceInsights(telemetry, orders);

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-white">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {guardrailStats.map((stat) => {
          const tone = getMarginStatusStyle(stat.status);
          return (
            <span
              key={stat.label}
              className={`rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${tone.border} ${tone.text}`}
            >
              {tone.label}: {stat.value}
            </span>
          );
        })}
      </div>
      {serviceInsights.length ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Service-level signals</p>
          <div className="grid gap-3 md:grid-cols-2">
            {serviceInsights.map((entry) => (
              <ServiceInsightCard key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AutomationServiceInsight = {
  key: string;
  providerLabel: string;
  serviceId: string;
  serviceLabel: string;
  guardrails: ProviderAutomationTelemetry["guardrailHitsByService"][string];
  overrides?: RuleOverrideServiceSummary;
};

function ProviderLoadAlertsCallout({ alerts }: { alerts: ProviderLoadAlert[] }) {
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Cohort load alerts</p>
      {alerts.length === 0 ? (
        <p className="text-sm text-white/60">No presets are overloading a single provider in the latest cohorts.</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {alerts.map((alert, index) => (
            <li key={`${alert.providerId}-${alert.presetId}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{alert.providerName ?? alert.providerId}</span>
                <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                  {percentFormatter.format(alert.shortShare)}
                </span>
              </div>
              <p className="text-xs text-white/60">{alert.presetLabel ?? alert.presetId}</p>
              <p className="text-[0.65rem] text-white/50">
                {alert.shortWindowDays}d vs {alert.longWindowDays}d · Δ {percentFormatter.format(alert.shareDelta)} ·{" "}
                {alert.shortEngagements} runs
              </p>
              {(alert.links?.merchandising || alert.links?.fulfillment || alert.links?.orders) && (
                <div className="mt-2 flex flex-wrap gap-2">
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
    </div>
  );
}

function AutomationServiceInsights({ entries }: { entries: AutomationServiceInsight[] }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Guardrail vs rule overrides</p>
        <p className="text-sm text-white/60">Spot services where breaches outpace automation overrides.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <ServiceInsightCard key={entry.key} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ServiceInsightCard({ entry }: { entry: AutomationServiceInsight }) {
  const incidents = entry.guardrails.fail * 2 + entry.guardrails.warn;
  const overrideTotal = entry.overrides?.totalOverrides ?? 0;
  const needsAttention = incidents > overrideTotal && incidents > 0;
  const topRule = resolveTopRule(entry.overrides);

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{entry.providerLabel}</p>
          <p className="text-xs text-white/60">{entry.serviceLabel}</p>
        </div>
        {needsAttention ? (
          <span className="text-[0.6rem] uppercase tracking-[0.3em] text-rose-300">Attention</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm text-white">
        <div className="rounded-lg border border-white/10 bg-black/30 p-2">
          <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Guardrail hits</p>
          <p className="text-xl font-semibold">{entry.guardrails.fail + entry.guardrails.warn}</p>
          <p className="text-[0.65rem] text-white/60">
            {entry.guardrails.fail} fail · {entry.guardrails.warn} warn
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2">
          <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Rule overrides</p>
          <p className="text-xl font-semibold">{overrideTotal}</p>
          <p className="text-[0.65rem] text-white/60">
            {topRule ? `Top: ${topRule.label ?? topRule.id}` : overrideTotal ? "Recorded" : "None recorded"}
          </p>
        </div>
      </div>
      {needsAttention ? (
        <p className="text-xs text-rose-200">Breaches exceed overrides — adjust guardrails or replay cadence.</p>
      ) : null}
    </div>
  );
}

function buildAutomationServiceInsights(
  providers: ProviderAutomationSnapshot["providers"],
): AutomationServiceInsight[] {
  const rows: AutomationServiceInsight[] = [];
  for (const provider of providers) {
    const guardrailMap = provider.telemetry.guardrailHitsByService ?? {};
    const overrideMap = provider.telemetry.ruleOverridesByService ?? {};
    const serviceIds = new Set([...Object.keys(guardrailMap), ...Object.keys(overrideMap)]);
    serviceIds.forEach((serviceId) => {
      rows.push({
        key: `${provider.id}-${serviceId}`,
        providerLabel: provider.name,
        serviceId,
        serviceLabel: serviceId,
        guardrails: guardrailMap[serviceId] ?? createGuardrailSummaryFallback(),
        overrides: overrideMap[serviceId],
      });
    });
  }
  return sortServiceInsights(rows);
}

function buildOrderServiceInsights(
  telemetry: ProviderAutomationTelemetry,
  orders: FulfillmentProviderOrder[],
): AutomationServiceInsight[] {
  const context = new Map<string, { providerLabel: string; providerId: string; serviceAction?: string | null }>();
  orders.forEach((order) => {
    if (!context.has(order.serviceId)) {
      context.set(order.serviceId, {
        providerLabel: order.providerName ?? order.providerId,
        providerId: order.providerId,
        serviceAction: order.serviceAction ?? null,
      });
    }
  });
  const guardrailMap = telemetry.guardrailHitsByService ?? {};
  const overrideMap = telemetry.ruleOverridesByService ?? {};
  const serviceIds = new Set([...Object.keys(guardrailMap), ...Object.keys(overrideMap)]);
  const rows: AutomationServiceInsight[] = [];
  serviceIds.forEach((serviceId) => {
    const meta = context.get(serviceId);
    rows.push({
      key: `${meta?.providerId ?? "service"}-${serviceId}`,
      providerLabel: meta?.providerLabel ?? meta?.providerId ?? "Provider",
      serviceId,
      serviceLabel: meta?.serviceAction ? `${serviceId} · ${meta.serviceAction}` : serviceId,
      guardrails: guardrailMap[serviceId] ?? createGuardrailSummaryFallback(),
      overrides: overrideMap[serviceId],
    });
  });
  return sortServiceInsights(rows);
}

function sortServiceInsights(entries: AutomationServiceInsight[]): AutomationServiceInsight[] {
  return [...entries].sort((a, b) => {
    const aIncidents = a.guardrails.fail * 2 + a.guardrails.warn;
    const bIncidents = b.guardrails.fail * 2 + b.guardrails.warn;
    if (bIncidents !== aIncidents) {
      return bIncidents - aIncidents;
    }
    const aOverrides = a.overrides?.totalOverrides ?? 0;
    const bOverrides = b.overrides?.totalOverrides ?? 0;
    return bOverrides - aOverrides;
  });
}

function resolveTopRule(
  overrides?: RuleOverrideServiceSummary,
): RuleOverrideServiceSummary["rules"][string] | null {
  if (!overrides) {
    return null;
  }
  const rules = Object.values(overrides.rules ?? {});
  if (!rules.length) {
    return null;
  }
  return [...rules].sort((a, b) => b.count - a.count)[0] ?? null;
}

function createGuardrailSummaryFallback(): ProviderAutomationTelemetry["guardrails"] {
  return { evaluated: 0, pass: 0, warn: 0, fail: 0 };
}

function getMarginStatusStyle(status: MarginStatus) {
  switch (status) {
    case "pass":
      return { border: "border-emerald-400/40", text: "text-emerald-200", label: "Healthy" };
    case "warn":
      return { border: "border-amber-400/40", text: "text-amber-200", label: "Warning" };
    case "fail":
      return { border: "border-rose-400/40", text: "text-rose-200", label: "Breached" };
    default:
      return { border: "border-white/20", text: "text-white/60", label: "Pending" };
  }
}
