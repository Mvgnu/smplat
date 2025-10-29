import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminBreadcrumbs,
  type AdminDataTableColumn,
  AdminDataTable,
  AdminKpiCard,
  AdminTabNav
} from "@/components/admin";
import { fetchAdminOrder, fetchAdminOrders } from "@/server/orders/admin-orders";
import { fetchOrderProgress } from "@/server/orders/progress";
import { getOrCreateCsrfToken } from "@/server/security/csrf";

import { ADMIN_PRIMARY_TABS } from "../admin-tabs";
import { OrderStatusFilters } from "./status-filter";
import { OrderStatusForm } from "./status-form";

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

const ORDER_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Orders" }
];

const ORDER_COLUMNS: AdminDataTableColumn<OrderSummary>[] = [
  {
    key: "orderNumber",
    header: "Order",
    render: (order) => (
      <Link className="flex flex-col gap-1 text-white" href={`/admin/orders?orderId=${order.id}`}>
        <span className="font-semibold">{order.orderNumber}</span>
        <span className="text-xs text-white/50">
          Created {dateTimeFormatter.format(new Date(order.createdAt))}
        </span>
      </Link>
    )
  },
  {
    key: "status",
    header: "Status",
    render: (order) => (
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
          statusTone[order.status] ?? "bg-white/10 text-white/70 border border-white/20"
        }`}
      >
        {statusLabels[order.status] ?? order.status}
      </span>
    )
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    render: (order) => <span>{formatCurrency(order.total, order.currency)}</span>
  },
  {
    key: "updatedAt",
    header: "Updated",
    align: "right",
    render: (order) => <span>{dateTimeFormatter.format(new Date(order.updatedAt))}</span>
  }
];

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const orders = await fetchAdminOrders(50);
  const csrfToken = getOrCreateCsrfToken();

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
          value={formatCurrency(totalVolume, currency)}
          footer={`${completedCount} completed`}
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Order queue</h2>
            <p className="text-sm text-white/50">Monitor new intents and prioritize fulfillment operations.</p>
          </div>
          <OrderStatusFilters />
        </div>
        <AdminDataTable
          columns={ORDER_COLUMNS}
          data={filteredOrders}
          rowKey={(order) => order.id}
          emptyState={
            <p>
              No orders in this state yet. Adjust the filter above or come back once new orders flow in.
            </p>
          }
        />
      </section>

      {effectiveOrder ? (
        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Order number</p>
              <h2 className="text-2xl font-semibold text-white">{effectiveOrder.orderNumber}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  statusTone[effectiveOrder.status] ?? "bg-white/10 text-white/70 border border-white/20"
                }`}
              >
                {statusLabels[effectiveOrder.status] ?? effectiveOrder.status}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-white/60">
                Updated {dateTimeFormatter.format(new Date(effectiveOrder.updatedAt))}
              </span>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminKpiCard label="Total" value={formatCurrency(effectiveOrder.total, effectiveOrder.currency)} />
            <AdminKpiCard
              label="Progress"
              value={progress ? `${progress.completedSteps}/${progress.totalSteps}` : "—"}
              footer={progress ? `Next: ${progress.nextStep ?? "Review"}` : "Awaiting update"}
            />
          </div>

          <OrderStatusForm orderId={effectiveOrder.id} currentStatus={effectiveOrder.status} csrfToken={csrfToken} />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Items</h3>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
              {effectiveOrder.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-white">{item.productTitle}</span>
                    <span className="text-white/70">{formatCurrency(item.totalPrice, effectiveOrder.currency)}</span>
                  </div>
                  <div className="text-xs text-white/50">
                    {item.quantity} × {formatCurrency(item.unitPrice, effectiveOrder.currency)}
                  </div>
                  {item.selectedOptions ? (
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-white/60">
                      {JSON.stringify(item.selectedOptions, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {progress ? (
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
