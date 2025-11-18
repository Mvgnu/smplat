import "server-only";

import { readFile } from "node:fs/promises";

import type { AdminOrder, OrderPayload } from "./admin-orders";
import { mapOrderPayload } from "./admin-orders";
import { fetchOrderDeliveryProof } from "./delivery-proof";
import { fetchDeliveryProofAggregates } from "@/server/metrics/delivery-proof-aggregates";
import type { DeliveryProofAggregateResponse, OrderDeliveryProof } from "@/types/delivery-proof";

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
const mockClientOrdersPath = process.env.MOCK_CLIENT_ORDER_HISTORY_PATH ?? null;
let mockClientOrdersCache: AdminOrder[] | null | undefined;
const authHeaders: HeadersInit = checkoutApiKey
  ? {
      "X-API-Key": checkoutApiKey
    }
  : {};

export async function fetchClientOrders(userId: string, limit = 10): Promise<ClientOrderSummary[]> {
  if (!userId) {
    return [];
  }

  const mockOrders = await loadMockClientOrders();
  if (mockOrders) {
    return filterOrdersForUser(mockOrders, userId)
      .slice(0, limit)
      .map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        currency: order.currency,
        updatedAt: order.updatedAt,
        createdAt: order.createdAt
      }));
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; cannot load client orders securely.");
    return [];
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/user/${userId}?limit=${limit}`, {
      headers: authHeaders,
      cache: "no-store"
    });

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

export type ClientOrderHistoryRecord = AdminOrder & {
  deliveryProof?: OrderDeliveryProof | null;
  deliveryProofAggregates?: DeliveryProofAggregateResponse | null;
};

type ClientOrderHistoryOptions = {
  includeDeliveryProof?: boolean;
};

export async function fetchClientOrderHistory(
  userId: string,
  limit = 10,
  options: ClientOrderHistoryOptions = {}
): Promise<ClientOrderHistoryRecord[]> {
  if (!userId) {
    return [];
  }

  const mockOrders = await loadMockClientOrders();
  if (mockOrders) {
    const orders = filterOrdersForUser(mockOrders, userId).slice(0, limit);
    if (!options.includeDeliveryProof) {
      return orders;
    }
    return augmentOrdersWithDeliveryProof(orders);
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; cannot load detailed client orders securely.");
    return [];
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/user/${userId}?limit=${limit}`, {
      headers: authHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      console.warn("Failed to fetch client order history", response.status);
      return [];
    }

    const payload = (await response.json()) as OrderPayload[];
    const orders = payload.map(mapOrderPayload);
    if (!options.includeDeliveryProof) {
      return orders;
    }
    return augmentOrdersWithDeliveryProof(orders);
  } catch (error) {
    console.warn("Unexpected error fetching client order history", error);
    return [];
  }
}

async function loadMockClientOrders(): Promise<AdminOrder[] | null> {
  if (!mockClientOrdersPath) {
    return null;
  }
  if (mockClientOrdersCache !== undefined) {
    return mockClientOrdersCache;
  }
  try {
    const file = await readFile(mockClientOrdersPath, "utf-8");
    const payload = JSON.parse(file) as OrderPayload[];
    mockClientOrdersCache = Array.isArray(payload) ? payload.map(mapOrderPayload) : [];
  } catch (error) {
    console.warn("Failed to read mock client orders", error);
    mockClientOrdersCache = [];
  }
  return mockClientOrdersCache;
}

const filterOrdersForUser = (orders: AdminOrder[], userId: string): AdminOrder[] =>
  orders.filter((order) => !order.userId || order.userId === userId);

const augmentOrdersWithDeliveryProof = async (
  orders: AdminOrder[]
): Promise<ClientOrderHistoryRecord[]> => {
  return Promise.all(
    orders.map(async (order) => {
      const productIds = Array.from(
        new Set(
          order.items
            .map((item) => item.productId)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      );
      const [deliveryProof, aggregates] = await Promise.all([
        fetchOrderDeliveryProof(order.id),
        productIds.length ? fetchDeliveryProofAggregates(productIds) : Promise.resolve(null),
      ]);
      return {
        ...order,
        deliveryProof,
        deliveryProofAggregates: aggregates,
      };
    })
  );
};
