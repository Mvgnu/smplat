import type { Metadata } from "next";
import Link from "next/link";

import { fetchAdminOrder, fetchAdminOrders } from "@/server/orders/admin-orders";
import { fetchOrderProgress } from "@/server/orders/progress";

import { OrderStatusForm } from "./status-form";

type AdminOrdersPageProps = {
  searchParams?: {
    orderId?: string;
  };
};

export const metadata: Metadata = {
  title: "Orders"
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
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const orders = await fetchAdminOrders(50);

  if (orders.length === 0) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Operations</p>
          <h1 className="mt-2 text-3xl font-semibold">Orders</h1>
          <p className="mt-3 text-white/70">
            Track every checkout and monitor fulfillment milestones in a single operations surface.
          </p>
        </header>
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center text-white/60 backdrop-blur">
          No orders yet. As soon as customers complete checkout, new orders will appear here.
        </section>
      </main>
    );
  }

  const requestedOrderId = searchParams?.orderId ?? null;
  let selectedOrderId = requestedOrderId && orders.some((order) => order.id === requestedOrderId)
    ? requestedOrderId
    : orders[0]?.id ?? null;

  const selectedOrder = selectedOrderId ? await fetchAdminOrder(selectedOrderId) : null;
  if (!selectedOrder && orders.length > 0) {
    selectedOrderId = orders[0].id;
  }

  const effectiveOrder = selectedOrder ?? (selectedOrderId ? await fetchAdminOrder(selectedOrderId) : null);
  const progress = effectiveOrder ? await fetchOrderProgress(effectiveOrder.id) : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 text-white">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Orders</h1>
        <p className="mt-3 text-white/70">
          Track storefront checkouts, review order context, and keep fulfillment moving.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[2fr,3fr] lg:items-start">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Order queue</h2>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-white/60">
                <tr>
                  <th className="px-5 py-3 font-semibold">Order</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Total</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.map((order) => {
                  const isActive = effectiveOrder?.id === order.id;
                  return (
                    <tr
                      key={order.id}
                      className={isActive ? "bg-white/5" : "hover:bg-white/5"}
                    >
                      <td className="px-5 py-3">
                        <Link
                          className="flex flex-col gap-1 text-white"
                          href={`/admin/orders?orderId=${order.id}`}
                        >
                          <span className="font-semibold">{order.orderNumber}</span>
                          <span className="text-xs text-white/50">
                            Created {dateTimeFormatter.format(new Date(order.createdAt))}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusTone[order.status] ?? "bg-white/10 text-white/70 border border-white/20"}`}
                        >
                          {statusLabels[order.status] ?? order.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/80">
                        {formatCurrency(order.total, order.currency)}
                      </td>
                      <td className="px-5 py-3 text-white/60">
                        {dateTimeFormatter.format(new Date(order.updatedAt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {effectiveOrder && (
          <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Order number</p>
                <p className="text-2xl font-semibold text-white">{effectiveOrder.orderNumber}</p>
              </div>
              <div className="text-sm text-white/60">
                Last updated {dateTimeFormatter.format(new Date(effectiveOrder.updatedAt))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Status</p>
                <p className="mt-2 text-lg font-semibold text-white">{statusLabels[effectiveOrder.status] ?? effectiveOrder.status}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Total</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {formatCurrency(effectiveOrder.total, effectiveOrder.currency)}
                </p>
              </div>
            </div>

            <OrderStatusForm orderId={effectiveOrder.id} currentStatus={effectiveOrder.status} />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/40">Items</h3>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                {effectiveOrder.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-white">{item.productTitle}</span>
                      <span className="text-white/70">
                        {formatCurrency(item.totalPrice, effectiveOrder.currency)}
                      </span>
                    </div>
                    <div className="text-xs text-white/50">
                      {item.quantity} × {formatCurrency(item.unitPrice, effectiveOrder.currency)}
                    </div>
                    {item.selectedOptions && (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-white/60">
                        {JSON.stringify(item.selectedOptions, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {effectiveOrder.notes && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/40">Notes</h3>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                  {effectiveOrder.notes}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/40">Fulfillment</h3>
              {progress ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ProgressCard label="Order status" value={progress.orderStatus.toUpperCase()} />
                  <ProgressCard
                    label="Completion"
                    value={`${progress.progressPercentage.toFixed(1)}%`}
                  />
                  <ProgressCard label="Total tasks" value={`${progress.totalTasks}`} />
                  <ProgressCard label="Completed" value={`${progress.completedTasks}`} />
                  <ProgressCard label="In progress" value={`${progress.inProgressTasks}`} />
                  <ProgressCard
                    label="Failed"
                    value={`${progress.failedTasks}`}
                    tone={progress.failedTasks > 0 ? "danger" : "default"}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                  No fulfillment summary available yet. Once tasks run, progress snapshots appear here.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

type ProgressCardProps = {
  label: string;
  value: string;
  tone?: "default" | "danger";
};

function ProgressCard({ label, value, tone = "default" }: ProgressCardProps) {
  const toneClasses =
    tone === "danger"
      ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
      : "border-white/10 bg-black/30 text-white/80";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
