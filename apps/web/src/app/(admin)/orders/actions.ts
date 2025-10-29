"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth/policies";
import { updateAdminOrderStatus } from "@/server/orders/admin-orders";
import { ensureCsrfToken } from "@/server/security/csrf";

export const ORDER_STATUS_OPTIONS = [
  "pending",
  "processing",
  "active",
  "completed",
  "on_hold",
  "canceled"
] as const;

export type UpdateOrderStatusState = {
  success: boolean;
  error?: string;
};

const initialState: UpdateOrderStatusState = { success: false };

export { initialState as updateOrderStatusInitialState };

export async function updateOrderStatusAction(
  _prevState: UpdateOrderStatusState,
  formData: FormData
): Promise<UpdateOrderStatusState> {
  await requireRole("operator");
  const csrfToken = formData.get("csrfToken");
  ensureCsrfToken({ tokenFromForm: typeof csrfToken === "string" ? csrfToken : null });

  const orderId = formData.get("orderId");
  const status = formData.get("status");

  if (typeof orderId !== "string" || typeof status !== "string") {
    return { success: false, error: "Invalid form submission." };
  }

  if (!ORDER_STATUS_OPTIONS.includes(status as (typeof ORDER_STATUS_OPTIONS)[number])) {
    return { success: false, error: "Unsupported status value." };
  }

  const didUpdate = await updateAdminOrderStatus(orderId, status);

  if (!didUpdate) {
    return { success: false, error: "Failed to update order status. Try again shortly." };
  }

  revalidatePath("/admin/orders");
  return { success: true };
}
