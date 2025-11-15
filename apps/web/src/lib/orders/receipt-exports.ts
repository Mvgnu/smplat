import { Buffer } from "node:buffer";

import type { AdminOrder } from "@/server/orders/admin-orders";

export type OrderReceiptPayload = Pick<
  AdminOrder,
  "id" | "orderNumber" | "status" | "total" | "currency" | "createdAt" | "updatedAt" | "notes" | "loyaltyProjectionPoints"
> & {
  items: AdminOrder["items"];
};

export const buildOrderReceiptPayload = (order: AdminOrder): OrderReceiptPayload => ({
  id: order.id,
  orderNumber: order.orderNumber,
  status: order.status,
  total: order.total,
  currency: order.currency,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  notes: order.notes,
  loyaltyProjectionPoints: order.loyaltyProjectionPoints,
  items: order.items
});

export const buildOrderJsonDownloadHref = (order: AdminOrder): string => {
  const payload = JSON.stringify(buildOrderReceiptPayload(order), null, 2);
  return `data:application/json;base64,${Buffer.from(payload).toString("base64")}`;
};

export const getOrderDownloadFilename = (order: AdminOrder): string => {
  const reference = order.orderNumber || order.id;
  return `smplat-order-${reference}.json`;
};
