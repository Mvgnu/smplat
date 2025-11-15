import type { Metadata } from "next";

import { formatAppliedAddOnLabel } from "@/lib/product-pricing";
import { requireRole } from "@/server/auth/policies";
import { fetchClientOrderHistory } from "@/server/orders/client-orders";
import { buildOrderJsonDownloadHref, getOrderDownloadFilename } from "@/lib/orders/receipt-exports";
import { CopyReceiptLinkButton } from "@/components/orders/copy-receipt-link-button";
import { summarizeProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { FulfillmentProviderOrder, FulfillmentProviderOrderReplayEntry } from "@/types/fulfillment";

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

export default async function AccountOrdersPage() {
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

  const orders = await fetchClientOrderHistory(userId, 25);

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

      {orders.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-white/20 bg-black/30 p-10 text-center text-white/60">
          <p className="text-sm uppercase tracking-[0.3em] text-white/40">No orders yet</p>
          <p className="mt-3 text-base text-white">
            Once you complete checkout, your receipt snapshots will appear here automatically.
          </p>
          <p className="mt-2 text-sm">Need help finalizing a blueprint? Reach out to your SMPLAT operator anytime.</p>
        </section>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const downloadHref = buildOrderJsonDownloadHref(order);
            const downloadFilename = getOrderDownloadFilename(order);
            const providerOrders = Array.isArray(order.providerOrders) ? order.providerOrders : [];
            const providerTelemetry = providerOrders.length
              ? summarizeProviderAutomationTelemetry(providerOrders)
              : null;
            const loyaltyProjection =
              typeof order.loyaltyProjectionPoints === "number" ? order.loyaltyProjectionPoints : null;
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
                  </div>
                </div>
              </header>
              {loyaltyProjection != null ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  This order earned approximately {formatPoints(loyaltyProjection)} loyalty points.
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-3 text-xs text-white/60">
                  Loyalty projection will appear on upcoming orders as soon as checkout records the points estimate.
                </div>
              )}

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
