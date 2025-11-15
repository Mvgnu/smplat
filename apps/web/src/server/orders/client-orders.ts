import "server-only";

import { readFile } from "node:fs/promises";

import type { AdminOrder, OrderPayload } from "./admin-orders";
import { mapOrderPayload } from "./admin-orders";

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

export async function fetchClientOrderHistory(userId: string, limit = 10): Promise<AdminOrder[]> {
  if (!userId) {
    return [];
  }

  const mockOrders = await loadMockClientOrders();
  if (mockOrders) {
    return filterOrdersForUser(mockOrders, userId).slice(0, limit);
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
    return payload.map(mapOrderPayload);
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
