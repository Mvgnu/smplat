"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { setLastSelectedOrder, updateNotificationPreferences } from "@/server/notifications/preferences";

export async function updateNotificationPreferencesAction(formData: FormData) {
  const userId = formData.get("userId");
  if (!userId || typeof userId !== "string") {
    throw new Error("Missing user identifier for preferences update.");
  }

  const orderUpdates = formData.get("orderUpdates") === "on";
  const paymentUpdates = formData.get("paymentUpdates") === "on";
  const fulfillmentAlerts = formData.get("fulfillmentAlerts") === "on";
  const marketingMessages = formData.get("marketingMessages") === "on";

  await updateNotificationPreferences(userId, {
    orderUpdates,
    paymentUpdates,
    fulfillmentAlerts,
    marketingMessages
  });

  revalidatePath("/dashboard");
}

export async function selectOrderAction(formData: FormData) {
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
