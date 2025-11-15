import "server-only";

export type NotificationPreferences = {
  orderUpdates: boolean;
  paymentUpdates: boolean;
  fulfillmentAlerts: boolean;
  marketingMessages: boolean;
  billingAlerts: boolean;
  lastSelectedOrderId: string | null;
};

const defaultPreferences: NotificationPreferences = {
  orderUpdates: true,
  paymentUpdates: true,
  fulfillmentAlerts: true,
  marketingMessages: false,
  billingAlerts: false,
  lastSelectedOrderId: null
};

type ApiPreference = {
  order_updates: boolean;
  payment_updates: boolean;
  fulfillment_alerts: boolean;
  marketing_messages: boolean;
  billing_alerts: boolean;
  last_selected_order_id: string | null;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const authApiKey =
  process.env.AUTH_API_KEY ??
  process.env.CHECKOUT_API_KEY ??
  process.env.NEXT_PUBLIC_AUTH_API_KEY ??
  undefined;

function buildHeaders(initHeaders: HeadersInit | undefined): Headers {
  const headers = new Headers(initHeaders ?? {});
  headers.set("Content-Type", "application/json");
  if (authApiKey) {
    headers.set("X-API-Key", authApiKey);
  }
  return headers;
}

async function fetchPreferenceFromApi(
  path: string,
  init: RequestInit = {},
  allowNotFound = false
): Promise<ApiPreference | null> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: buildHeaders(init.headers),
    cache: "no-store"
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await safeReadResponse(response);
    throw new Error(`Notifications API ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as ApiPreference;
}

export async function getOrCreateNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  try {
    const preference = await fetchPreferenceFromApi(`/api/v1/notifications/preferences/${userId}`);
    return preference ? mapPreference(preference) : { ...defaultPreferences };
  } catch (error) {
    console.warn("Failed to load notification preferences", error);
    return { ...defaultPreferences };
  }
}

type PreferenceToggleUpdates = Partial<Omit<NotificationPreferences, "lastSelectedOrderId">>;

export async function updateNotificationPreferences(
  userId: string,
  updates: PreferenceToggleUpdates
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  const payload: Record<string, unknown> = {};
  if (updates.orderUpdates !== undefined) payload.order_updates = updates.orderUpdates;
  if (updates.paymentUpdates !== undefined) payload.payment_updates = updates.paymentUpdates;
  if (updates.fulfillmentAlerts !== undefined) payload.fulfillment_alerts = updates.fulfillmentAlerts;
  if (updates.marketingMessages !== undefined) payload.marketing_messages = updates.marketingMessages;
  if (updates.billingAlerts !== undefined) payload.billing_alerts = updates.billingAlerts;

  try {
    const preference = await fetchPreferenceFromApi(
      `/api/v1/notifications/preferences/${userId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
    return preference ? mapPreference(preference) : { ...defaultPreferences };
  } catch (error) {
    console.warn("Failed to update notification preferences", error);
    return { ...defaultPreferences };
  }
}

export async function setLastSelectedOrder(
  userId: string,
  orderId: string
): Promise<NotificationPreferences> {
  if (!userId) {
    return { ...defaultPreferences };
  }

  try {
    const preference = await fetchPreferenceFromApi(
      `/api/v1/notifications/preferences/${userId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ last_selected_order_id: orderId })
      }
    );
    return preference ? mapPreference(preference) : { ...defaultPreferences };
  } catch (error) {
    console.warn("Failed to set last selected order", error);
    return { ...defaultPreferences };
  }
}

function mapPreference(preference: ApiPreference): NotificationPreferences {
  return {
    orderUpdates: preference.order_updates,
    paymentUpdates: preference.payment_updates,
    fulfillmentAlerts: preference.fulfillment_alerts,
    marketingMessages: preference.marketing_messages,
    billingAlerts: preference.billing_alerts,
    lastSelectedOrderId: preference.last_selected_order_id
  };
}

async function safeReadResponse(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (data && typeof data === "object" && "detail" in data) {
      return String((data as { detail?: unknown }).detail);
    }
    return JSON.stringify(data);
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}
