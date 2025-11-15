"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/server/auth/policies";
import { setLastSelectedOrder, updateNotificationPreferences } from "@/server/notifications/preferences";
import { ensureCsrfToken } from "@/server/security/csrf";

export async function updateNotificationPreferencesAction(formData: FormData) {
  await requireRole("member", {
    context: {
      route: "client.dashboard.updateNotificationPreferences",
      method: "POST"
    }
  });
  const csrfToken = formData.get("csrfToken");
  ensureCsrfToken({ tokenFromForm: typeof csrfToken === "string" ? csrfToken : null });

  const userId = formData.get("userId");
  if (!userId || typeof userId !== "string") {
    throw new Error("Missing user identifier for preferences update.");
  }

  const orderUpdates = formData.get("orderUpdates") === "on";
  const paymentUpdates = formData.get("paymentUpdates") === "on";
  const fulfillmentAlerts = formData.get("fulfillmentAlerts") === "on";
  const marketingMessages = formData.get("marketingMessages") === "on";
  const billingAlerts = formData.get("billingAlerts") === "on";

  await updateNotificationPreferences(userId, {
    orderUpdates,
    paymentUpdates,
    fulfillmentAlerts,
    marketingMessages,
    billingAlerts
  });

  revalidatePath("/dashboard");
}

export async function selectOrderAction(formData: FormData) {
  await requireRole("member", {
    context: {
      route: "client.dashboard.selectOrder",
      method: "POST"
    }
  });
  const csrfToken = formData.get("csrfToken");
  ensureCsrfToken({ tokenFromForm: typeof csrfToken === "string" ? csrfToken : null });

  const userId = formData.get("userId");
  const orderId = formData.get("orderId");

  if (!userId || typeof userId !== "string") {
    throw new Error("Missing user identifier for order selection.");
  }

  if (!orderId || typeof orderId !== "string") {
    throw new Error("Missing order identifier.");
  }

  await setLastSelectedOrder(userId, orderId);
  revalidatePath("/dashboard");
  redirect(`/dashboard?orderId=${encodeURIComponent(orderId)}`);
}
