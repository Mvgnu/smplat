export const ORDER_STATUS_OPTIONS = [
  "pending",
  "processing",
  "active",
  "completed",
  "on_hold",
  "canceled"
] as const;

export type OrderStatus = (typeof ORDER_STATUS_OPTIONS)[number];
