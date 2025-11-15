import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TextEncoder, TextDecoder } from "util";

import type { AdminOrder } from "@/server/orders/admin-orders";
import AccountOrdersPage from "../page";

// jsdom lacks TextEncoder/TextDecoder when rendering server components. Polyfill them.
if (typeof global.TextEncoder === "undefined") {
  // @ts-expect-error - assigning to global for Jest environment
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  // @ts-expect-error - assigning to global for Jest environment
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}

const mockRequireRole = jest.fn();
const mockFetchClientOrderHistory = jest.fn();

jest.mock("@/server/auth/policies", () => ({
  requireRole: (input: unknown) => mockRequireRole(input)
}));

jest.mock("@/server/orders/client-orders", () => ({
  fetchClientOrderHistory: (...args: unknown[]) => mockFetchClientOrderHistory(...args)
}));

jest.mock("@/components/orders/copy-receipt-link-button", () => ({
  CopyReceiptLinkButton: ({ orderNumber }: { orderNumber: string }) => (
    <span data-testid="copy-link">Copy {orderNumber}</span>
  )
}));

describe("AccountOrdersPage", () => {
  beforeEach(() => {
    mockRequireRole.mockReset();
    mockFetchClientOrderHistory.mockReset();
  });

  it("renders provider automation telemetry when providerOrders exist", async () => {
    mockRequireRole.mockResolvedValue({ session: { user: { id: "user-1" } } });
    const order: AdminOrder = {
      id: "order-1",
      orderNumber: "SM0001",
      userId: "user-1",
      status: "processing",
      source: "checkout",
      subtotal: 100,
      tax: 0,
      total: 100,
      currency: "USD",
      notes: "loyaltyProjection=2400",
      createdAt: "2024-04-01T00:00:00.000Z",
      updatedAt: "2024-04-01T00:10:00.000Z",
      loyaltyProjectionPoints: 2400,
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          productTitle: "Growth Package",
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          selectedOptions: {
            options: [
              {
                groupId: "grp",
                groupName: "Package",
                optionId: "opt",
                label: "Starter",
                priceDelta: 0,
                structuredPricing: null,
                marketingTagline: null,
                fulfillmentSla: null,
                heroImageUrl: null
              }
            ]
          },
          attributes: null
        }
      ],
      providerOrders: [
        {
          id: "provider-order-1",
          providerId: "provider-1",
          providerName: "Growth Vendor",
          serviceId: "svc-1",
          serviceAction: "order",
          orderId: "order-1",
          orderItemId: "item-1",
          amount: 70,
          currency: "USD",
          providerOrderId: "remote-1",
          payload: {
            providerCostAmount: 60
          },
          createdAt: "2024-04-01T00:01:00.000Z",
          updatedAt: "2024-04-01T00:05:00.000Z",
          refills: [
            {
              id: "refill-1",
              amount: 10,
              currency: "USD",
              performedAt: "2024-04-01T00:06:00.000Z",
              response: null
            }
          ],
          replays: [
            {
              id: "replay-1",
              requestedAmount: 70,
              currency: "USD",
              performedAt: "2024-04-01T00:07:00.000Z",
              scheduledFor: null,
              status: "executed",
              response: null,
              ruleIds: [],
              ruleMetadata: null
            }
          ],
          scheduledReplays: [
            {
              id: "scheduled-1",
              requestedAmount: 70,
              currency: "USD",
              performedAt: null,
              scheduledFor: "2024-04-02T00:00:00.000Z",
              status: "scheduled",
              response: null,
              ruleIds: [],
              ruleMetadata: null
            }
          ]
        }
      ]
    };
    mockFetchClientOrderHistory.mockResolvedValue([order]);

    const html = renderToStaticMarkup(await AccountOrdersPage());

    expect(html).toContain("Provider automation");
    expect(html).toContain("Growth Vendor");
    expect(html).toContain("Scheduled pending");
    expect(html).toContain("Manual refills");
    expect(html).toContain("This order earned approximately 2,400 loyalty points.");
  });
});
