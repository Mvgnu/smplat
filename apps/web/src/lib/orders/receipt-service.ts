import { fetchDeliveryProofAggregates } from "@/server/metrics/delivery-proof-aggregates";
import { fetchAdminOrder } from "@/server/orders/admin-orders";
import { fetchOrderDeliveryProof } from "@/server/orders/delivery-proof";
import { buildOrderReceiptPayload, type OrderReceiptPayload } from "./receipt-exports";

const uniqueStrings = (values: (string | null | undefined)[]): string[] => {
  const entries = new Set<string>();
  values.forEach((value) => {
    if (typeof value === "string" && value.length > 0) {
      entries.add(value);
    }
  });
  return Array.from(entries);
};

export async function loadOrderReceipt(orderId: string): Promise<OrderReceiptPayload | null> {
  if (!orderId) {
    return null;
  }
  const order = await fetchAdminOrder(orderId);
  if (!order) {
    return null;
  }

  const productIds = uniqueStrings(order.items.map((item) => item.productId));

  const [deliveryProof, aggregates] = await Promise.all([
    fetchOrderDeliveryProof(order.id),
    productIds.length ? fetchDeliveryProofAggregates(productIds) : Promise.resolve(null),
  ]);

  return buildOrderReceiptPayload(order, {
    deliveryProof,
    deliveryProofAggregates: aggregates,
  });
}
