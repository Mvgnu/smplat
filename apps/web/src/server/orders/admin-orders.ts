import "server-only";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export type AdminOrderItem = {
  id: string;
  productId: string | null;
  productTitle: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
};

export type AdminOrder = {
  id: string;
  orderNumber: string;
  userId: string | null;
  status: string;
  source: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
};

type OrderItemPayload = {
  id: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  selected_options: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
};

type OrderPayload = {
  id: string;
  order_number: string;
  user_id: string | null;
  status: string;
  source: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItemPayload[];
};

const mapOrder = (payload: OrderPayload): AdminOrder => ({
  id: payload.id,
  orderNumber: payload.order_number,
  userId: payload.user_id,
  status: payload.status,
  source: payload.source,
  subtotal: Number(payload.subtotal ?? 0),
  tax: Number(payload.tax ?? 0),
  total: Number(payload.total ?? 0),
  currency: payload.currency,
  notes: payload.notes,
  createdAt: payload.created_at,
  updatedAt: payload.updated_at,
  items: Array.isArray(payload.items)
    ? payload.items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productTitle: item.product_title,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
        totalPrice: Number(item.total_price ?? 0),
        selectedOptions: item.selected_options ?? null,
        attributes: item.attributes ?? null
      }))
    : []
});

const defaultHeaders: HeadersInit = checkoutApiKey
  ? {
      "X-API-Key": checkoutApiKey
    }
  : {};

export async function fetchAdminOrders(limit = 50): Promise<AdminOrder[]> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders?limit=${limit}`, {
      headers: defaultHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      console.warn("Failed to fetch admin orders", response.status);
      return [];
    }

    const payload = (await response.json()) as OrderPayload[];
    return payload.map(mapOrder);
  } catch (error) {
    console.warn("Unexpected error fetching admin orders", error);
    return [];
  }
}

export async function fetchAdminOrder(orderId: string): Promise<AdminOrder | null> {
  if (!orderId) {
    return null;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}`, {
      headers: defaultHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn("Failed to fetch admin order", orderId, response.status);
      }
      return null;
    }

    const payload = (await response.json()) as OrderPayload;
    return mapOrder(payload);
  } catch (error) {
    console.warn("Unexpected error fetching admin order", orderId, error);
    return null;
  }
}

export async function updateAdminOrderStatus(orderId: string, status: string): Promise<boolean> {
  if (!orderId || !status) {
    return false;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...defaultHeaders
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      console.warn("Failed to update admin order status", orderId, status, response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Unexpected error updating admin order status", orderId, error);
    return false;
  }
}
