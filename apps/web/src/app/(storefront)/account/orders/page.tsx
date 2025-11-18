import type { Metadata } from "next";
import Link from "next/link";

import {
  buildDeliveryProofInsights,
  extractMetricNumber,
  formatFollowerValue,
  formatRelativeTimestamp,
  formatSignedNumber,
  type DeliveryProofInsight,
} from "@/lib/delivery-proof-insights";
import { formatAppliedAddOnLabel } from "@/lib/product-pricing";
import { isPricingExperimentCopyEnabled } from "@/lib/pricing-experiments";
import { requireRole } from "@/server/auth/policies";
import { fetchClientOrderHistory } from "@/server/orders/client-orders";
import {
  buildOrderJsonDownloadHref,
  getOrderDownloadFilename,
  type BuildOrderReceiptOptions,
} from "@/lib/orders/receipt-exports";
import { CopyReceiptLinkButton } from "@/components/orders/copy-receipt-link-button";
import { summarizeProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { FulfillmentProviderOrder, FulfillmentProviderOrderReplayEntry } from "@/types/fulfillment";
import { Sparkles, Users } from "lucide-react";
import { formatPlatformContextLabel } from "@/lib/platform-context";
import type { ClientOrderHistoryRecord } from "@/server/orders/client-orders";
import { fetchReceiptStorageComponent, type ReceiptStorageComponent } from "@/server/health/readiness";
import { fetchGuardrailWorkflowTelemetrySummary } from "@/server/reporting/guardrail-workflow-telemetry";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import type { QuickOrderTelemetryContext } from "@/types/quick-order";
import { QuickOrderTelemetryCard } from "./QuickOrderTelemetryCard";

export const metadata: Metadata = {
  title: "Orders",
  description: "Review every purchase and the exact blueprint selections captured at checkout."
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  active: "Active",
  completed: "Completed",
  on_hold: "On Hold",
  canceled: "Canceled"
};

const statusTone: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-200 border border-amber-400/30",
  processing: "bg-blue-500/10 text-blue-200 border border-blue-400/30",
  active: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/30",
  completed: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/30",
  on_hold: "bg-orange-500/10 text-orange-200 border border-orange-400/30",
  canceled: "bg-rose-500/10 text-rose-200 border border-rose-400/30"
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);

const formatDateTimeValue = (value: string | null | undefined) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

const formatMaybeCurrency = (
  value: number | null | undefined,
  currency: string | null | undefined,
  fallbackCurrency: string
) => (typeof value === "number" ? formatCurrency(value, currency ?? fallbackCurrency) : "—");

const formatPoints = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(value);

const REPLAY_STATUS_LABELS: Record<FulfillmentProviderOrderReplayEntry["status"], string> = {
  executed: "Executed",
  scheduled: "Scheduled",
  failed: "Failed"
};

const REPLAY_STATUS_TONE: Record<FulfillmentProviderOrderReplayEntry["status"], string> = {
  executed: "border border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  scheduled: "border border-sky-400/30 bg-sky-500/10 text-sky-100",
  failed: "border border-rose-400/30 bg-rose-500/10 text-rose-100"
};

const describeReplayTimestamp = (entry: FulfillmentProviderOrderReplayEntry) => {
  if (entry.status === "scheduled") {
    return entry.scheduledFor ? formatDateTimeValue(entry.scheduledFor) : "Awaiting schedule";
  }
  if (entry.performedAt) {
    return formatDateTimeValue(entry.performedAt);
  }
  if (entry.scheduledFor) {
    return formatDateTimeValue(entry.scheduledFor);
  }
  return "Awaiting run";
};

type OrderPricingExperimentDisplay = {
  slug: string;
  name: string;
  variantName: string;
  isControl: boolean;
  assignmentStrategy: string | null;
  status: string | null;
  featureFlagKey: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPricingExperimentAttribute = (
  attributes: Record<string, unknown> | null | undefined,
): OrderPricingExperimentDisplay | null => {
  if (!attributes || !isRecord(attributes)) {
    return null;
  }
  const payload =
    (attributes as Record<string, unknown>).pricingExperiment ??
    (attributes as Record<string, unknown>).pricing_experiment;
  if (!isRecord(payload)) {
    return null;
  }
  const slug = typeof payload.slug === "string" ? payload.slug : null;
  const variantKey = typeof payload.variantKey === "string" ? payload.variantKey : null;
  if (!slug || !variantKey) {
    return null;
  }
  const variantName =
    typeof payload.variantName === "string"
      ? payload.variantName
      : typeof payload.variant_key === "string"
        ? payload.variant_key
        : variantKey;
  const assignmentStrategy =
    typeof payload.assignmentStrategy === "string"
      ? payload.assignmentStrategy
      : typeof payload.assignment_strategy === "string"
        ? payload.assignment_strategy
        : null;
  return {
    slug,
    name: typeof payload.name === "string" ? payload.name : slug,
    variantName,
    isControl:
      typeof payload.isControl === "boolean"
        ? payload.isControl
        : typeof payload.is_control === "boolean"
          ? payload.is_control
          : false,
    assignmentStrategy,
    status: typeof payload.status === "string" ? payload.status : null,
    featureFlagKey:
      typeof payload.featureFlagKey === "string"
        ? payload.featureFlagKey
        : typeof payload.feature_flag_key === "string"
          ? payload.feature_flag_key
          : null,
  };
};

const collectOrderPricingExperiments = (
  items: Array<{ attributes: Record<string, unknown> | null }>,
): OrderPricingExperimentDisplay[] => {
  const segments = new Map<string, OrderPricingExperimentDisplay>();
  items.forEach((item) => {
    const segment = readPricingExperimentAttribute(item.attributes);
    if (segment) {
      segments.set(segment.slug, segment);
    }
  });
  return Array.from(segments.values());
};

const buildLoyaltyExperimentHref = (slug: string): string =>
  `/account/loyalty?experiment=${encodeURIComponent(slug)}`;

type AccountOrdersPageProps = {
  searchParams?: {
    experiment?: string;
  };
};

export default async function AccountOrdersPage({ searchParams }: AccountOrdersPageProps) {
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.account.orders.page",
      method: "GET"
    }
  });

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Account orders page requires an authenticated user.");
  }

  const [orders, receiptStorageStatus, workflowTelemetry] = await Promise.all([
    fetchClientOrderHistory(userId, 25, { includeDeliveryProof: true }),
    fetchReceiptStorageComponent(),
    fetchGuardrailWorkflowTelemetrySummary().catch(() => null),
  ]);
  const quickOrderContext = buildQuickOrderTelemetryContext(orders);
  const experimentSlug =
    typeof searchParams?.experiment === "string" && searchParams.experiment.trim().length > 0
      ? searchParams.experiment.trim().toLowerCase()
      : null;

  const filteredOrders =
    experimentSlug && experimentSlug.length > 0
      ? orders.filter((order) => {
          const experiments = collectOrderPricingExperiments(order.items);
          return experiments.some((experiment) => experiment.slug.toLowerCase() === experimentSlug);
        })
      : orders;

  return (
    <div className="space-y-8 text-white">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Receipts</p>
        <h1 className="mt-2 text-2xl font-semibold">Order archive</h1>
        <p className="mt-3 text-sm text-white/70">
          Every blueprint you purchased is preserved here—taglines, calculators, and SLAs included—so you can share or
          revisit a configuration anytime.
        </p>
      </section>

      {experimentSlug ? (
        <section className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-6 text-sm text-white/80">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">Experiment filter</p>
          <p className="mt-2">
            Showing orders linked to <span className="font-semibold text-white">{searchParams?.experiment}</span>. Use the loyalty hub to inspect nudges + ledger
            entries for the same slug or clear this filter below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link
              href={`/account/loyalty?experiment=${encodeURIComponent(searchParams?.experiment ?? "")}`}
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/60 hover:text-white"
            >
              View loyalty context
            </Link>
            <Link
              href="/account/orders"
              className="inline-flex items-center justify-center rounded-full border border-transparent px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
            >
              Clear filter
            </Link>
          </div>
        </section>
      ) : null}

      <QuickOrderTelemetryCard
        context={quickOrderContext}
        receiptStatus={receiptStorageStatus}
        workflowTelemetry={workflowTelemetry}
      />

      {filteredOrders.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-white/20 bg-black/30 p-10 text-center text-white/60">
          <p className="text-sm uppercase tracking-[0.3em] text-white/40">No orders yet</p>
          <p className="mt-3 text-base text-white">
            Once you complete checkout, your receipt snapshots will appear here automatically.
          </p>
          <p className="mt-2 text-sm">Need help finalizing a blueprint? Reach out to your SMPLAT operator anytime.</p>
        </section>
      ) : (
        <div className="space-y-6">
          {filteredOrders.map((order) => {
            const receiptOptions: BuildOrderReceiptOptions = {
              deliveryProof: order.deliveryProof ?? null,
              deliveryProofAggregates: order.deliveryProofAggregates ?? null,
            };
            const downloadHref = buildOrderJsonDownloadHref(order, receiptOptions);
            const downloadFilename = getOrderDownloadFilename(order);
            const pdfHref = order.receiptStorageUrl ?? `/api/orders/${order.id}/receipt`;
            const providerOrders = Array.isArray(order.providerOrders) ? order.providerOrders : [];
            const providerTelemetry = providerOrders.length
              ? summarizeProviderAutomationTelemetry(providerOrders)
              : null;
            const loyaltyProjection =
              typeof order.loyaltyProjectionPoints === "number" ? order.loyaltyProjectionPoints : null;
            const pricingExperiments = collectOrderPricingExperiments(order.items);
            const visiblePricingExperiments = pricingExperiments.filter((experiment) =>
              isPricingExperimentCopyEnabled(experiment.status, experiment.featureFlagKey)
            );
            const deliveryProofInsights = buildDeliveryProofInsights(
              order.items.map((item) => ({
                id: item.id,
                productId: item.productId,
                productTitle: item.productTitle,
                platformContext: item.platformContext,
              })),
              {
                proof: order.deliveryProof,
                aggregates: order.deliveryProofAggregates,
              }
            );
            return (
            <article key={order.id} className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Order number</p>
                  <h2 className="text-xl font-semibold text-white">#{order.orderNumber}</h2>
                  <p className="text-sm text-white/60">Placed {dateTimeFormatter.format(new Date(order.createdAt))}</p>
                </div>
                <div className="flex flex-col items-start gap-2 text-sm text-white/70 md:items-end">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      statusTone[order.status] ?? "bg-white/10 text-white/70 border border-white/20"
                    }`}
                  >
                    {statusLabels[order.status] ?? order.status}
                  </span>
                  <span className="text-lg font-semibold text-white">{formatCurrency(order.total, order.currency)}</span>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <CopyReceiptLinkButton orderId={order.id} orderNumber={order.orderNumber} />
                    <a
                      href={downloadHref}
                      download={downloadFilename}
                      className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                    >
                      Download JSON
                    </a>
                    <a
                      href={pdfHref}
                      className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                    >
                      Download PDF
                    </a>
                  </div>
                </div>
              </header>
              {loyaltyProjection != null ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  This order earned approximately {formatPoints(loyaltyProjection)} loyalty points.
                  {visiblePricingExperiments.length > 0 ? (
                    <>
                      {" "}
                      Triggered by{" "}
                      <span className="font-semibold">
                        {visiblePricingExperiments[0].variantName} · {visiblePricingExperiments[0].name}
                      </span>
                      .{" "}
                      <Link
                        href={buildLoyaltyExperimentHref(visiblePricingExperiments[0].slug)}
                        className="text-emerald-200 underline-offset-4 hover:underline"
                      >
                        Review loyalty context
                      </Link>
                      .
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-3 text-xs text-white/60">
                  Loyalty projection will appear on upcoming orders as soon as checkout records the points estimate.
                </div>
              )}

              {(() => {
                if (visiblePricingExperiments.length === 0) {
                  return null;
                }
                return (
                  <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-sm text-white/70">
                    <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">Pricing experiments</p>
                    <p className="mt-1">
                      These services ran through the dynamic pricing lab. Variant badges stay visible while the
                      experiment status + feature flag allow storefront copy, loyalty digests, and concierge scripts to
                      stay in sync.
                    </p>
                    <ul className="mt-3 space-y-2">
                      {visiblePricingExperiments.map((experiment) => (
                        <li
                          key={experiment.slug}
                          className="space-y-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{experiment.name}</p>
                              <p className="text-white/60">
                                {experiment.isControl ? "Control cohort" : "Challenger cohort"}
                                {experiment.status ? ` · ${experiment.status}` : ""}
                                {experiment.featureFlagKey ? ` · Flag ${experiment.featureFlagKey}` : ""}
                              </p>
                            </div>
                            <span
                              className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-amber-100"
                              title={experiment.assignmentStrategy ?? undefined}
                            >
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              Triggered by {experiment.variantName}
                            </span>
                          </div>
                          {experiment.assignmentStrategy ? (
                            <p className="text-white/60">Assignment: {experiment.assignmentStrategy}</p>
                          ) : null}
                          <Link
                            href={buildLoyaltyExperimentHref(experiment.slug)}
                            className="inline-flex text-[11px] font-semibold text-emerald-200 underline-offset-4 hover:underline"
                          >
                            View loyalty context
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {order.items.length === 0 ? (
                <p className="text-sm text-white/60">No items were captured for this order.</p>
              ) : (
                <div className="space-y-4">
                  {order.items.map((item) => {
                    const blueprint = item.selectedOptions;
                    const hasBlueprint =
                      Boolean(blueprint?.options?.length) ||
                      Boolean(blueprint?.addOns?.length) ||
                      Boolean(blueprint?.subscriptionPlan);
                    const experimentMeta = readPricingExperimentAttribute(item.attributes);

                    return (
                      <section key={item.id} className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-base font-semibold text-white">{item.productTitle}</p>
                            <p className="text-xs text-white/50">
                              {item.quantity} × {formatCurrency(item.unitPrice, order.currency)}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-white">
                            {formatCurrency(item.totalPrice, order.currency)}
                          </span>
                        </div>
                        {item.platformContext ? (
                          <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
                            <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-sky-100">
                              <Users className="h-3 w-3" aria-hidden="true" />
                              {formatPlatformContextLabel(item.platformContext)}
                            </span>
                          </div>
                        ) : null}
                        {experimentMeta ? (
                          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-amber-100">
                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                            {experimentMeta.name} · {experimentMeta.variantName}
                          </div>
                        ) : null}

                        {blueprint?.options?.length ? (
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-wide text-white/40">Blueprint options</p>
                            <ul className="space-y-2">
                              {blueprint.options.map((selection) => {
                                const deltaLabel =
                                  selection.priceDelta !== 0
                                    ? `${selection.priceDelta > 0 ? "+" : "-"}${formatCurrency(
                                        Math.abs(selection.priceDelta),
                                        order.currency
                                      )}`
                                    : "included";
                                return (
                                  <li
                                    key={`${selection.groupId}-${selection.optionId}`}
                                    className="space-y-1 rounded-xl border border-white/10 bg-black/40 p-3"
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
                                        <p className="font-mono text-white">{selection.calculator.expression}</p>
                                        <div className="flex flex-wrap gap-3 text-white/50">
                                          {selection.calculator.sampleAmount != null ? (
                                            <span>Input: {selection.calculator.sampleAmount}</span>
                                          ) : null}
                                          {selection.calculator.sampleDays != null ? (
                                            <span>Days: {selection.calculator.sampleDays}</span>
                                          ) : null}
                                          {selection.calculator.sampleResult != null ? (
                                            <span>Result: {selection.calculator.sampleResult}</span>
                                          ) : null}
                                        </div>
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        {blueprint?.addOns?.length ? (
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-wide text-white/40">Applied add-ons</p>
                            <ul className="space-y-2 text-sm text-white/80">
                              {blueprint.addOns.map((addOn) => {
                                const labels = formatAppliedAddOnLabel(
                                  {
                                    mode: addOn.pricingMode ?? "flat",
                                    amount: addOn.pricingAmount ?? addOn.priceDelta,
                                    serviceId: addOn.serviceId ?? null,
                                    serviceProviderName: addOn.serviceProviderName ?? null,
                                    serviceAction: addOn.serviceAction ?? null,
                                    serviceDescriptor: addOn.serviceDescriptor ?? null,
                                    previewQuantity: addOn.previewQuantity ?? null,
                                  },
                                  addOn.priceDelta,
                                  order.currency
                                );

                                return (
                                  <li
                                    key={addOn.id}
                                    className="space-y-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex flex-col">
                                        <span className="font-semibold text-white">{addOn.label}</span>
                                        {labels.secondary ? (
                                          <span className="text-xs text-white/50">{labels.secondary}</span>
                                        ) : null}
                                      </div>
                                      <span className="text-xs uppercase tracking-[0.3em] text-white/60">
                                        {labels.primary}
                                      </span>
                                    </div>
                                    {addOn.previewQuantity != null || addOn.payloadTemplate ? (
                                      <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[0.65rem] text-white/60">
                                        {addOn.previewQuantity != null ? (
                                          <p>Preview quantity: {addOn.previewQuantity}</p>
                                        ) : null}
                                        {addOn.payloadTemplate ? (
                                          <details>
                                            <summary className="cursor-pointer text-white/50">Payload template</summary>
                                            <pre className="mt-1 max-h-32 overflow-auto text-white/50">
                                              {JSON.stringify(addOn.payloadTemplate, null, 2)}
                                            </pre>
                                          </details>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        {blueprint?.subscriptionPlan ? (
                          <div className="space-y-1 text-xs text-white/60">
                            <p className="uppercase tracking-wide text-white/40">Subscription plan</p>
                            <p className="text-sm text-white/70">{blueprint.subscriptionPlan.label}</p>
                            <p>
                              Billing: {blueprint.subscriptionPlan.billingCycle.replace("_", " ")}
                              {blueprint.subscriptionPlan.priceMultiplier != null
                                ? ` · multiplier ${blueprint.subscriptionPlan.priceMultiplier.toFixed(2)}`
                                : ""}
                              {blueprint.subscriptionPlan.priceDelta != null
                                ? ` · delta ${formatCurrency(
                                    blueprint.subscriptionPlan.priceDelta,
                                    order.currency
                                  )}`
                                : ""}
                            </p>
                          </div>
                        ) : null}

                        {hasBlueprint ? (
                          <details className="rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/60">
                            <summary className="cursor-pointer text-white/80">Raw selection payload</summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-white/70">
                              {JSON.stringify(blueprint, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              )}

              {deliveryProofInsights.length ? (
                <AccountDeliveryProofInsights
                  insights={deliveryProofInsights}
                  generatedAt={order.deliveryProof?.generatedAt ?? null}
                  windowDays={order.deliveryProofAggregates?.windowDays ?? null}
                />
              ) : null}

              {providerOrders.length ? (
                <section
                  className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4"
                  data-testid="account-provider-automation"
                >
                  <div className="flex flex-col gap-1">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Provider automation</p>
                    <p className="text-xs text-white/60">
                      Replay attempts, manual refills, and queued runs for this order propagate directly from the provider
                      network.
                    </p>
                  </div>
                  {providerTelemetry ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        { label: "Provider orders", value: providerTelemetry.totalOrders },
                        { label: "Replays executed", value: providerTelemetry.replays.executed },
                        { label: "Replays failed", value: providerTelemetry.replays.failed },
                        { label: "Scheduled pending", value: providerTelemetry.replays.scheduled }
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{stat.label}</p>
                          <p className="mt-1 text-lg font-semibold text-white">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    {providerOrders.map((providerOrder) => {
                      const replays = Array.isArray(providerOrder.replays) ? providerOrder.replays : [];
                      const scheduledReplays = Array.isArray(providerOrder.scheduledReplays)
                        ? providerOrder.scheduledReplays
                        : [];
                      const refills = Array.isArray(providerOrder.refills) ? providerOrder.refills : [];
                      const scheduledPending = scheduledReplays.filter((entry) => entry.status === "scheduled").length;
                      const defaultCurrency = providerOrder.currency ?? order.currency;
                      return (
                        <div
                          key={providerOrder.id}
                          className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4"
                          data-testid="account-provider-order-card"
                        >
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {providerOrder.providerName ?? providerOrder.providerId}
                              </p>
                              <p className="text-xs text-white/60">
                                Service {providerOrder.serviceId}
                                {providerOrder.serviceAction ? ` · ${providerOrder.serviceAction}` : ""}
                              </p>
                              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                                Provider order {providerOrder.providerOrderId ?? "—"}
                              </p>
                            </div>
                            <div className="text-sm text-white/70 md:text-right">
                              <p className="font-semibold">
                                {formatMaybeCurrency(providerOrder.amount, providerOrder.currency, order.currency)}
                              </p>
                              <p className="text-xs text-white/50">
                                Updated {formatDateTimeValue(providerOrder.updatedAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.3em] text-white/50">
                            <span className="rounded-full border border-white/15 px-3 py-1">Replays {replays.length}</span>
                            <span className="rounded-full border border-white/15 px-3 py-1">
                              Scheduled {scheduledPending}
                            </span>
                            <span className="rounded-full border border-white/15 px-3 py-1">Refills {refills.length}</span>
                          </div>
                          <div className="space-y-3">
                            <ReplayTimeline title="Scheduled replays" entries={scheduledReplays} currency={defaultCurrency} />
                            <ReplayTimeline title="Replay history" entries={replays} currency={defaultCurrency} />
                            <RefillTimeline entries={refills} currency={defaultCurrency} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </article>
          )})}
        </div>
      )}
    </div>
  );
}

function ReplayTimeline({
  title,
  entries,
  currency
}: {
  title: string;
  entries: FulfillmentProviderOrderReplayEntry[];
  currency: string;
}) {
  if (!entries.length) {
    return null;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{title}</p>
      <ul className="space-y-1 text-xs text-white/70">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          >
            <span className={`rounded-full px-2 py-0.5 text-[0.55rem] font-semibold ${REPLAY_STATUS_TONE[entry.status]}`}>
              {REPLAY_STATUS_LABELS[entry.status]}
            </span>
            <span className="text-white/60">{describeReplayTimestamp(entry)}</span>
            {typeof entry.requestedAmount === "number" ? (
              <span className="font-semibold text-white">{formatCurrency(entry.requestedAmount, currency)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefillTimeline({
  entries,
  currency
}: {
  entries: FulfillmentProviderOrder["refills"];
  currency: string;
}) {
  if (!entries.length) {
    return null;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Manual refills</p>
      <ul className="space-y-1 text-xs text-white/70">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          >
            <span className="font-semibold text-white">
              {typeof entry.amount === "number"
                ? formatCurrency(entry.amount, entry.currency ?? currency)
                : "—"}
            </span>
            <span className="text-white/60">{formatDateTimeValue(entry.performedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccountDeliveryProofInsights({
  insights,
  generatedAt,
  windowDays,
}: {
  insights: DeliveryProofInsight[];
  generatedAt: string | null;
  windowDays: number | null;
}) {
  if (!insights.length) {
    return null;
  }
  const refreshed = formatRelativeTimestamp(generatedAt);
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Delivery proof</p>
        <p className="text-sm text-white/60">
          Before/after snapshots sync directly from automation. If a line is still ramping, we show aggregate lift so you
          always see trustworthy context.
        </p>
        {refreshed ? (
          <p className="text-xs text-white/50">Last refreshed {refreshed}.</p>
        ) : null}
      </div>
      <div className="space-y-3">
        {insights.map((insight) => (
          <AccountDeliveryProofInsightCard
            key={insight.item.id}
            insight={insight}
            windowDays={windowDays}
          />
        ))}
      </div>
    </section>
  );
}

function AccountDeliveryProofInsightCard({ insight, windowDays }: { insight: DeliveryProofInsight; windowDays: number | null }) {
  const baselineFollowers = extractMetricNumber(insight.proof?.baseline, "followerCount");
  const latestFollowers = extractMetricNumber(insight.proof?.latest, "followerCount");
  const deltaFollowers =
    baselineFollowers != null && latestFollowers != null ? latestFollowers - baselineFollowers : null;
  const baselineCaptured = formatRelativeTimestamp(insight.proof?.baseline?.recordedAt ?? null);
  const latestCaptured = formatRelativeTimestamp(insight.proof?.latest?.recordedAt ?? null);
  const followerAggregate =
    insight.aggregate?.metrics.find((metric) => metric.metricKey === "followerCount") ?? null;
  const sampleTextParts: string[] = [];
  if (insight.aggregate?.sampleSize) {
    sampleTextParts.push(`n=${insight.aggregate.sampleSize}`);
  }
  if (windowDays && windowDays > 0) {
    sampleTextParts.push(`${windowDays}-day window`);
  }
  return (
    <article className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{insight.item.productTitle}</p>
          <p className="text-xs text-white/60">
            {insight.proof?.account?.handle
              ? `@${insight.proof.account.handle} · ${insight.proof.account.platform ?? "Unknown platform"}`
              : insight.item.platformContext?.handle
                ? `Awaiting link for ${insight.item.platformContext.handle}`
                : "No linked account"}
          </p>
        </div>
        {latestCaptured ? (
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Latest {latestCaptured}</p>
        ) : null}
      </div>
      {insight.proof ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Baseline</p>
            <p className="text-2xl font-semibold text-white">{formatFollowerValue(baselineFollowers)}</p>
            {baselineCaptured ? (
              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Captured {baselineCaptured}</p>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Latest</p>
            <p className="text-2xl font-semibold text-white">{formatFollowerValue(latestFollowers)}</p>
            {latestCaptured ? (
              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Captured {latestCaptured}</p>
            ) : null}
            {insight.proof.latest?.warnings?.length ? (
              <p className="mt-1 text-xs text-amber-200">Warnings: {insight.proof.latest.warnings.join(", ")}</p>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Delta</p>
            <p className="text-2xl font-semibold text-white">{formatSignedNumber(deltaFollowers)}</p>
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Follower lift</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/15 bg-black/10 p-3 text-sm text-white/60">
          Automation is lining up the first delivery snapshot for this item. We’ll email the receipt update once metrics
          land.
        </div>
      )}
      {followerAggregate ? (
        <p className="text-xs text-white/60">
          {!insight.proof
            ? "While we capture your live metrics, campaigns with similar blueprints average"
            : "Benchmarks show"}{" "}
          {followerAggregate.formattedDelta ??
            (typeof followerAggregate.deltaAverage === "number"
              ? formatSignedNumber(followerAggregate.deltaAverage)
              : "steady movement")}
          {followerAggregate.formattedPercent ? ` (${followerAggregate.formattedPercent})` : ""} follower change{followerAggregate.formattedLatest ? ` with latest avg ${followerAggregate.formattedLatest}` : ""}.
          {sampleTextParts.length ? ` Sample ${sampleTextParts.join(" · ")}.` : ""}
        </p>
      ) : null}
    </article>
  );
}

function buildQuickOrderTelemetryContext(
  orders: ClientOrderHistoryRecord[],
): QuickOrderTelemetryContext | null {
  for (const order of orders) {
    if (!order.items?.length) {
      continue;
    }
    const insights = buildDeliveryProofInsights(
      order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productTitle: item.productTitle,
        platformContext: item.platformContext,
      })),
      {
        proof: order.deliveryProof,
        aggregates: order.deliveryProofAggregates,
      },
    );
    if (!insights.length) {
      continue;
    }
    const prioritized = insights.find((entry) => entry.proof) ?? insights[0];
    const sourceItem = order.items.find((item) => item.id === prioritized.item.id) ?? null;
    const baselineFollowers = extractMetricNumber(prioritized.proof?.baseline, "followerCount");
    const latestFollowers = extractMetricNumber(prioritized.proof?.latest, "followerCount");
    const delta =
      baselineFollowers != null && latestFollowers != null
        ? latestFollowers - baselineFollowers
        : latestFollowers ?? baselineFollowers;
    const providerOrders = Array.isArray(order.providerOrders) ? order.providerOrders : [];
    const providerTelemetry = providerOrders.length
      ? summarizeProviderAutomationTelemetry(providerOrders as FulfillmentProviderOrder[])
      : null;

    const platformHandleFromProof = prioritized.proof?.account?.handle
      ? `@${prioritized.proof.account.handle}`
      : null;
    const platformHandle = platformHandleFromProof ?? sourceItem?.platformContext?.handle ?? prioritized.item.platformContext?.handle ?? null;
    const platformType = prioritized.proof?.account?.platform
      ? prioritized.proof.account.platform.toLowerCase()
      : sourceItem?.platformContext?.platformType ?? prioritized.item.platformContext?.platformType ?? null;

    return {
      productTitle: prioritized.item.productTitle,
      productId: prioritized.item.productId,
      platformLabel:
        prioritized.proof?.account?.handle && prioritized.proof?.account?.platform
          ? `@${prioritized.proof.account.handle} · ${prioritized.proof.account.platform}`
          : formatPlatformContextLabel(prioritized.item.platformContext ?? sourceItem?.platformContext) ?? "Active platform",
      platformHandle,
      platformType,
      platformContextId: sourceItem?.platformContext?.id ?? prioritized.item.platformContext?.id ?? null,
      followerBaseline: formatFollowerValue(baselineFollowers),
      followerDelta: formatSignedNumber(delta),
      lastSnapshotRelative: formatRelativeTimestamp(
        prioritized.proof?.latest?.recordedAt ?? prioritized.proof?.baseline?.recordedAt ?? null,
      ),
      providerTelemetry,
      selection: sourceItem?.selectedOptions ?? null,
    };
  }
  return null;
}
