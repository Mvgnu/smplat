import "server-only";

import { prisma } from "@/server/db/client";
import type { NotificationPreference as PrismaNotificationPreference } from "@prisma/client";

export type NotificationPreferences = {
  orderUpdates: boolean;
  paymentUpdates: boolean;
  fulfillmentAlerts: boolean;
  marketingMessages: boolean;
  lastSelectedOrderId: string | null;
};

const defaultPreferences: NotificationPreferences = {
  orderUpdates: true,
  paymentUpdates: true,
  fulfillmentAlerts: true,
  marketingMessages: false,
  lastSelectedOrderId: null
};

export async function getOrCreateNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  const preference = await prisma.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      ...defaultPreferences
    }
  });

  return mapPreference(preference);
}

type PreferenceToggleUpdates = Partial<Omit<NotificationPreferences, "lastSelectedOrderId">>;

export async function updateNotificationPreferences(
  userId: string,
  updates: PreferenceToggleUpdates
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  const preference = await prisma.notificationPreference.upsert({
    where: { userId },
    update: updates,
    create: {
      userId,
      ...defaultPreferences,
      ...updates
    }
  });

  return mapPreference(preference);
}

export async function setLastSelectedOrder(
  userId: string,
  orderId: string
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  const preference = await prisma.notificationPreference.upsert({
    where: { userId },
    update: { lastSelectedOrderId: orderId },
    create: {
      userId,
      ...defaultPreferences,
      lastSelectedOrderId: orderId
    }
  });

  return mapPreference(preference);
}

function mapPreference(preference: PrismaNotificationPreference): NotificationPreferences {
  return {
    orderUpdates: preference.orderUpdates,
    paymentUpdates: preference.paymentUpdates,
    fulfillmentAlerts: preference.fulfillmentAlerts,
    marketingMessages: preference.marketingMessages,
    lastSelectedOrderId: preference.lastSelectedOrderId
  };
}
