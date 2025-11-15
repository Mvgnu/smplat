"use client";

import Link from "next/link";

import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin";
import type { AdminOrder } from "@/server/orders/admin-orders";

import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  ORDER_DATE_TIME_FORMATTER,
  formatOrderCurrency
} from "./order-presenters";

type OrdersTableProps = {
  orders: AdminOrder[];
};

const ORDER_COLUMNS: AdminDataTableColumn<AdminOrder>[] = [
  {
    key: "orderNumber",
    header: "Order",
    render: (order) => (
      <Link className="flex flex-col gap-1 text-white" href={`/admin/orders?orderId=${order.id}`}>
        <span className="font-semibold">{order.orderNumber}</span>
        <span className="text-xs text-white/50">
          Created {ORDER_DATE_TIME_FORMATTER.format(new Date(order.createdAt))}
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
          ORDER_STATUS_TONE[order.status] ?? "bg-white/10 text-white/70 border border-white/20"
        }`}
      >
        {ORDER_STATUS_LABELS[order.status] ?? order.status}
      </span>
    )
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    render: (order) => <span>{formatOrderCurrency(order.total, order.currency)}</span>
  },
  {
    key: "updatedAt",
    header: "Updated",
    align: "right",
    render: (order) => <span>{ORDER_DATE_TIME_FORMATTER.format(new Date(order.updatedAt))}</span>
  }
];

export function OrdersTable({ orders }: OrdersTableProps) {
  return (
    <AdminDataTable
      columns={ORDER_COLUMNS}
      data={orders}
      rowKey={(order) => order.id}
      emptyState={
        <div className="text-white/70">
          <p className="text-lg font-semibold text-white">No orders match the selected filter.</p>
          <p className="text-sm">Change tabs or clear filters to see more results.</p>
        </div>
      }
    />
  );
}
