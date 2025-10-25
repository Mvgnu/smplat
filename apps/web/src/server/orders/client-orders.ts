import "server-only";

type ClientOrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  currency: string;
  updatedAt: string;
  createdAt: string;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export async function fetchClientOrders(userId: string, limit = 10): Promise<ClientOrderSummary[]> {
  if (!userId) {
    return [];
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; cannot load client orders securely.");
    return [];
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/orders/user/${userId}?limit=${limit}`,
      {
        headers: {
          "X-API-Key": checkoutApiKey
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      console.warn("Failed to fetch client orders", response.status);
      return [];
    }

    const payload = (await response.json()) as Array<{
      id: string;
      order_number: string;
      status: string;
      total: number;
      currency: string;
      updated_at: string;
      created_at: string;
    }>;

    return payload.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      total: order.total,
      currency: order.currency,
      updatedAt: order.updated_at,
      createdAt: order.created_at
    }));
  } catch (error) {
    console.warn("Unexpected error fetching client orders", error);
    return [];
  }
}
