import { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { BillingCenter } from "@/components/dashboard/billing/BillingCenter";
import { fetchBillingCenterPayload } from "@/server/billing/invoices";
import { fetchCatalogSearchInsights } from "@/server/observability/catalog-insights";
import { fetchClientOrders } from "@/server/orders/client-orders";
import { fetchOrderProgress } from "@/server/orders/progress";
import { fetchInstagramAnalytics } from "@/server/instagram/analytics";
import { getOrCreateNotificationPreferences, setLastSelectedOrder } from "@/server/notifications/preferences";
import { fetchOnboardingJourney } from "@/server/onboarding/journeys";
import { requireRole } from "@/server/auth/policies";
import { getOrCreateCsrfToken } from "@/server/security/csrf";

import { selectOrderAction, updateNotificationPreferencesAction } from "./actions";

type DashboardPageProps = {
  searchParams?: {
    orderId?: string;
  };
};

export const metadata: Metadata = {
  title: "Client Dashboard"
};

const currencyFormatter = (currency: string | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export default async function ClientDashboardPage({ searchParams }: DashboardPageProps) {
  const { session } = await requireRole("member", {
    context: {
      route: "client.dashboard.page",
      method: "GET"
    }
  });
  const userId = session.user?.id;

  if (!userId) {
    return null;
  }

  const csrfToken = getOrCreateCsrfToken();

  const [orders, catalogInsights, instagramAccounts, preferences] = await Promise.all([
    fetchClientOrders(userId, 25),
    fetchCatalogSearchInsights(),
    fetchInstagramAnalytics(userId, 30),
    getOrCreateNotificationPreferences(userId)
  ]);

  const billing = await fetchBillingCenterPayload({
    workspaceId: userId,
    orders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      total: order.total
    })),
    instagram: instagramAccounts
  });

  let selectedOrderId = searchParams?.orderId?.trim() ?? null;
  if (selectedOrderId && !orders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = null;
  }

  const persistedOrderId = preferences.lastSelectedOrderId;
  if (!selectedOrderId && persistedOrderId && orders.some((order) => order.id === persistedOrderId)) {
    selectedOrderId = persistedOrderId;
  }

  if (!selectedOrderId && orders.length > 0) {
    selectedOrderId = orders[0].id;
  }

  if (selectedOrderId && selectedOrderId !== persistedOrderId) {
    await setLastSelectedOrder(userId, selectedOrderId);
  }

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;
  const orderProgress = selectedOrderId ? await fetchOrderProgress(selectedOrderId) : null;
  const onboardingJourney = selectedOrderId ? await fetchOnboardingJourney(selectedOrderId) : null;

  const currencyForSummary = selectedOrder?.currency ?? orders[0]?.currency ?? "EUR";
  const currencyFormatterForSummary = currencyFormatter(currencyForSummary);
  const lifetimeSpend = orders.reduce((sum, order) => sum + order.total, 0);
  const activeOrdersCount = orders.filter((order) =>
    ["processing", "active"].includes(order.status.toLowerCase())
  ).length;
  const completedOrdersCount = orders.filter(
    (order) => order.status.toLowerCase() === "completed"
  ).length;
  const averageOrderValue = orders.length > 0 ? lifetimeSpend / orders.length : 0;

  const zeroResultsRate =
    typeof catalogInsights.zeroResultsRate === "number"
      ? Math.round(catalogInsights.zeroResultsRate * 100)
      : null;

  const averageResults =
    typeof catalogInsights.averageResultsPerSearch === "number"
      ? catalogInsights.averageResultsPerSearch.toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-white">Fulfillment progress</h2>
            <p className="text-sm text-white/60">
              Orders assigned to your workspace are listed here. Select one to review automated
              fulfillment milestones and any blocking issues before delivery completes.
            </p>
          </div>

          {orders.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
              No live orders yet. Once checkout sessions complete, their fulfillment milestones will
              appear here automatically.
            </div>
          )}

          {orders.length > 0 && (
            <>
              <div className="grid gap-4 text-white/80 md:grid-cols-3">
                <StatCard
                  label="Recent revenue"
                  value={currencyFormatterForSummary.format(lifetimeSpend)}
                  hint="Across last 25 orders"
                />
                <StatCard
                  label="Average order value"
                  value={currencyFormatterForSummary.format(averageOrderValue)}
                  hint="Includes in-flight campaigns"
                />
                <StatCard
                  label="Active vs completed"
                  value={`${activeOrdersCount} active · ${completedOrdersCount} completed`}
                />
              </div>

              <form action={selectOrderAction} className="flex flex-col gap-4 md:flex-row md:items-end">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <label className="flex flex-1 flex-col gap-2 text-sm text-white/70">
                  Order
                  <select
                    name="orderId"
                    defaultValue={selectedOrderId ?? ""}
                    className="rounded-2xl border border-white/15 bg-black/30 px-4 py-2 text-white outline-none transition focus:border-white/50"
                  >
                    {orders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.orderNumber} · {order.status.toUpperCase()} ·{" "}
                        {currencyFormatter(order.currency).format(order.total)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  View progress
                </button>
              </form>

              {selectedOrder && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-white/70">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Order number</p>
                      <p className="mt-1 text-lg font-semibold text-white">{selectedOrder.orderNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Last updated</p>
                      <p className="mt-1 text-white/80">
                        {dateTimeFormatter.format(new Date(selectedOrder.updatedAt))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Order total</p>
                      <p className="mt-1 text-white">
                        {currencyFormatter(selectedOrder.currency).format(selectedOrder.total)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {orderProgress ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  <ProgressStat label="Order status" value={orderProgress.orderStatus.toUpperCase()} />
                  <ProgressStat
                    label="Completion"
                    value={`${orderProgress.progressPercentage.toFixed(1)}%`}
                  />
                  <ProgressStat label="Fulfillment tasks" value={`${orderProgress.totalTasks}`} />
                  <ProgressStat label="Completed tasks" value={`${orderProgress.completedTasks}`} />
                  <ProgressStat label="In progress" value={`${orderProgress.inProgressTasks}`} />
                  <ProgressStat
                    label="Failed tasks"
                    value={`${orderProgress.failedTasks}`}
                    tone={orderProgress.failedTasks > 0 ? "danger" : "default"}
                  />
                </div>
              ) : (
                selectedOrderId && (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    Unable to load progress details for{" "}
                    <span className="font-medium">{selectedOrder?.orderNumber ?? selectedOrderId}</span>.
                    Confirm the identifier is correct and that the API key is configured.
                  </div>
                )
              )}

              {onboardingJourney ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-white/70">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Onboarding status</p>
                      <p className="mt-1 text-white">
                        {onboardingJourney.status?.toUpperCase() ?? "UNKNOWN"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Checklist completion</p>
                      <p className="mt-1 text-white">
                        {`${Math.round(onboardingJourney.progress_percentage ?? 0)}%`}
                      </p>
                    </div>
                    {onboardingJourney.referral_code ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Referral code</p>
                        <p className="mt-1 font-mono text-white">
                          {onboardingJourney.referral_code}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <ul className="mt-4 space-y-3">
                    {[...onboardingJourney.tasks]
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                      .map((task) => {
                        const isComplete = task.status?.toLowerCase() === "completed";
                        return (
                          <li
                            key={task.id}
                            className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
                          >
                            <div className="flex-1 space-y-1">
                              <p className="font-semibold text-white">{task.title}</p>
                              {task.description ? (
                                <p className="text-xs text-white/60">{task.description}</p>
                              ) : null}
                            </div>
                            <CheckCircle2
                              className={`h-5 w-5 flex-shrink-0 ${isComplete ? "text-emerald-300" : "text-white/30"}`}
                            />
                          </li>
                        );
                      })}
                    {onboardingJourney.tasks.length === 0 ? (
                      <li className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-3 text-xs text-white/50">
                        Operators are provisioning your onboarding tasks.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <OrderTable orders={orders.slice(0, 6)} selectedOrderId={selectedOrderId} />
            </>
          )}
        </div>
      </section>

      <BillingCenter
        invoices={billing.invoices}
        summary={billing.summary}
        aging={billing.aging}
        insights={billing.insights}
        sessionsReport={billing.sessionsReport}
        recoveryTimeline={billing.recoveryTimeline}
      />

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-white">Catalog telemetry overview</h2>
            <p className="text-sm text-white/60">
              Highlights from `/api/v1/observability/catalog-search` combine storefront insights with
              Prometheus counters for merchandising reviews.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <h3 className="text-sm font-medium uppercase tracking-[0.3em] text-white/40">
                Trending queries
              </h3>
              <InsightList
                emptyLabel="No recent searches."
                items={catalogInsights.trendingQueries.map((entry) => ({
                  name: entry.query,
                  value: entry.count
                }))}
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <h3 className="text-sm font-medium uppercase tracking-[0.3em] text-white/40">
                Zero-result queries
              </h3>
              <InsightList
                emptyLabel="No zero-result searches logged."
                items={catalogInsights.zeroResultQueries.map((entry) => ({
                  name: entry.query,
                  value: entry.count
                }))}
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <h3 className="text-sm font-medium uppercase tracking-[0.3em] text-white/40">Snapshot</h3>
              <ul className="mt-4 space-y-3 text-sm text-white/70">
                <li className="flex items-center justify-between">
                  <span>Total searches</span>
                  <span className="font-semibold text-white">{catalogInsights.totalSearches}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Zero-result searches</span>
                  <span className="font-semibold text-white">{catalogInsights.zeroResults}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Zero-result rate</span>
                  <span className="font-semibold text-white">
                    {zeroResultsRate !== null ? `${zeroResultsRate}%` : "—"}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Average results per search</span>
                  <span className="font-semibold text-white">{averageResults ?? "—"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Recent sample size</span>
                  <span className="font-semibold text-white">{catalogInsights.sampleSize}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-white">Instagram performance</h2>
            <p className="text-sm text-white/60">
              Track how connected Instagram accounts are progressing. Metrics pull from fulfillment
              automation snapshots captured over the last 30 days.
            </p>
          </div>

          {instagramAccounts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
              No Instagram accounts are currently linked to this profile. Once fulfillment verifies a
              handle, daily analytics will populate here automatically.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {instagramAccounts.map((account) => (
                <InstagramAccountCard
                  key={account.id}
                  account={account}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-white">Notification preferences</h2>
            <p className="text-sm text-white/60">
              Choose which alerts land in your inbox. Updates respect these toggles immediately for all
              automated lifecycle emails.
            </p>
          </div>

          <form action={updateNotificationPreferencesAction} className="space-y-4">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <PreferenceToggle
              id="orderUpdates"
              name="orderUpdates"
              label="Order lifecycle updates"
              description="Receive a summary when orders are created, activated, or completed."
              defaultChecked={preferences.orderUpdates}
            />
            <PreferenceToggle
              id="paymentUpdates"
              name="paymentUpdates"
              label="Payment status alerts"
              description="Get notified about successful charges, payment retries, and refunded transactions."
              defaultChecked={preferences.paymentUpdates}
            />
            <PreferenceToggle
              id="fulfillmentAlerts"
              name="fulfillmentAlerts"
              label="Fulfillment anomalies"
              description="Escalate stalled tasks, max retry warnings, and manual intervention requests."
              defaultChecked={preferences.fulfillmentAlerts}
            />
            <PreferenceToggle
              id="billingAlerts"
              name="billingAlerts"
              label="Billing alerts"
              description="Receive reminders for overdue invoices and ledger exports."
              defaultChecked={preferences.billingAlerts}
            />
            <PreferenceToggle
              id="marketingMessages"
              name="marketingMessages"
              label="Insights & marketing digests"
              description="Opt in for experimentation playbooks, growth insights, and merchandising digests."
              defaultChecked={preferences.marketingMessages}
            />

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <p className="text-sm text-white/60">
                Preferences apply across all channels supported by your workspace account.
              </p>
              <button
                type="submit"
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Save preferences
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

type ProgressStatProps = {
  label: string;
  value: string;
  tone?: "default" | "danger";
};

function ProgressStat({ label, value, tone = "default" }: ProgressStatProps) {
  const toneClasses =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-white/10 bg-white/5 text-white";

  return (
    <div className={`rounded-2xl border ${toneClasses} p-6`}>
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

type InsightListProps = {
  items: Array<{ name: string; value: number }>;
  emptyLabel: string;
};

function InsightList({ items, emptyLabel }: InsightListProps) {
  if (items.length === 0) {
    return <p className="mt-4 text-sm text-white/60">{emptyLabel}</p>;
  }

  return (
    <ul className="mt-4 space-y-3 text-sm text-white/70">
      {items.map((item) => (
        <li key={item.name} className="flex items-center justify-between">
          <span className="truncate pr-3">{item.name}</span>
          <span className="font-semibold text-white">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

type OrderTableProps = {
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    currency: string;
    updatedAt: string;
    createdAt: string;
  }>;
  selectedOrderId: string | null;
};

function OrderTable({ orders, selectedOrderId }: OrderTableProps) {
  if (orders.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-6 py-4">
        <h3 className="text-sm font-semibold text-white">Recent orders</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm text-white/70">
          <thead className="text-xs uppercase tracking-[0.2em] text-white/40">
            <tr>
              <th className="px-6 py-3">Order</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Total</th>
              <th className="px-6 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {orders.map((order) => {
              const formatter = currencyFormatter(order.currency);
              const isActive = order.id === selectedOrderId;
              return (
                <tr
                  key={order.id}
                  className={isActive ? "bg-white/5 text-white" : "hover:bg-white/5"}
                >
                  <td className="px-6 py-3 font-medium">{order.orderNumber}</td>
                  <td className="px-6 py-3 uppercase">{order.status}</td>
                  <td className="px-6 py-3">{formatter.format(order.total)}</td>
                  <td className="px-6 py-3">{dateTimeFormatter.format(new Date(order.updatedAt))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type PreferenceToggleProps = {
  id: string;
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
};

function PreferenceToggle({ id, name, label, description, defaultChecked }: PreferenceToggleProps) {
  return (
    <label
      htmlFor={id}
      className="flex items-start justify-between gap-6 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 transition hover:border-white/25"
    >
      <span className="flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-2 block text-sm text-white/60">{description}</span>
      </span>
      <span className="flex items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="h-5 w-5 cursor-pointer accent-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        />
      </span>
    </label>
  );
}

type InstagramAccountCardProps = {
  account: Awaited<ReturnType<typeof fetchInstagramAnalytics>>[number];
};

function InstagramAccountCard({ account }: InstagramAccountCardProps) {
  const history = account.history;
  const recentHistory = history.slice(0, 5);
  const latest = history[0];
  const previous = history[1];
  const followerDeltaLabel = formatFollowerDelta(latest, previous);
  const engagement = latest ? `${latest.engagementRate.toFixed(2)}%` : "—";
  const sparklinePoints = buildSparklinePoints(history);
  const chronologicalRecent = [...recentHistory].reverse();

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Handle</p>
          <p className="mt-1 text-lg font-semibold text-white">@{account.username}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Last sync</p>
          <p className="mt-1 text-sm text-white/70">
            {account.lastSyncedAt ? dateTimeFormatter.format(new Date(account.lastSyncedAt)) : "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Followers</p>
          <p className="mt-1 text-lg font-semibold">{account.followerCount ?? "—"}</p>
          <p className="text-xs text-white/60">{followerDeltaLabel}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Engagement</p>
          <p className="mt-1 text-lg font-semibold">{engagement}</p>
          <p className="text-xs text-white/60">
            Reach {latest ? latest.reach.toLocaleString() : "—"} · Impressions{" "}
            {latest ? latest.impressions.toLocaleString() : "—"}
          </p>
        </div>
      </div>

      {sparklinePoints && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Follower trend</p>
          <svg viewBox="0 0 100 40" className="mt-2 h-16 w-full text-blue-300" aria-hidden="true">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              points={sparklinePoints}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">Recent snapshots</p>
        <ul className="mt-3 space-y-2 text-xs text-white/60">
          {chronologicalRecent.map((entry) => (
            <li
              key={entry.date}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
            >
              <span>{dateTimeFormatter.format(new Date(entry.date))}</span>
              <span className="flex items-center gap-3 font-semibold text-white">
                <span>{entry.followers.toLocaleString()} followers</span>
                <span className="text-white/60">{entry.engagementRate.toFixed(2)}% ER</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
};

function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/50">{hint}</p>}
    </div>
  );
}

type InstagramAccountData = Awaited<ReturnType<typeof fetchInstagramAnalytics>>[number];
type InstagramHistoryData = InstagramAccountData["history"];

function buildSparklinePoints(history: InstagramHistoryData): string {
  if (history.length === 0) {
    return "";
  }

  if (history.length === 1) {
    return "0,20 100,20";
  }

  const chronological = [...history].reverse();
  const followerCounts = chronological.map((entry) => entry.followers);
  const minFollowers = Math.min(...followerCounts);
  const maxFollowers = Math.max(...followerCounts);
  const range = maxFollowers - minFollowers || 1;

  const points = chronological.map((entry, index) => {
    const x =
      chronological.length > 1 ? (index / (chronological.length - 1)) * 100 : 0;
    const normalized = (entry.followers - minFollowers) / range;
    const y = 40 - normalized * 40;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return points.join(" ");
}

function formatFollowerDelta(
  latest: InstagramHistoryData[number] | undefined,
  previous: InstagramHistoryData[number] | undefined
): string {
  if (!latest) {
    return "No data available";
  }

  if (!previous) {
    return "Recent snapshot";
  }

  const delta = latest.followers - previous.followers;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toLocaleString()} vs. prior`;
}
