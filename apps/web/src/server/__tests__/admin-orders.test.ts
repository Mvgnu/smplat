import { mapOrderPayload, type OrderPayload } from "@/server/orders/admin-orders";

describe("mapOrderPayload", () => {
  it("normalizes blueprint selections for order items", () => {
    const payload: OrderPayload = {
      id: "order-1",
      order_number: "ORD-1",
      user_id: null,
      status: "completed",
      source: "checkout",
      subtotal: 200,
      tax: 0,
      total: 200,
      currency: "EUR",
      notes: null,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:10:00.000Z",
      items: [
        {
          id: "item-1",
          product_id: "prod-1",
          product_title: "Instagram Growth",
          quantity: 1,
          unit_price: 200,
          total_price: 200,
          selected_options: {
            options: [
              {
                groupId: "grp-1",
                groupName: "Package",
                optionId: "opt-1",
                label: "Starter",
                priceDelta: 50,
                structuredPricing: {
                  amount: 100,
                  amountUnit: "followers",
                  basePrice: 150,
                  unitPrice: 1.5,
                },
                marketingTagline: "100 followers / €3",
                fulfillmentSla: "72h turnaround",
                heroImageUrl: "https://cdn.example.com/hero.png",
                calculator: {
                  expression: "amount / days",
                  sampleAmount: 100,
                  sampleDays: 5,
                  sampleResult: 20,
                },
              },
            ],
            addOns: [
              {
                id: "addon-1",
                label: "Priority boost",
                priceDelta: 30,
                pricingMode: "flat",
                pricingAmount: 30,
                payloadTemplate: { geo: "eu" },
                previewQuantity: 150,
                providerCostAmount: 45,
                providerCostCurrency: "USD",
                marginTarget: 0.22,
                serviceRules: [
                  {
                    id: "rule-boost",
                    conditions: [{ kind: "channel", channels: ["storefront"] }],
                    overrides: { providerId: "vendor-99" },
                  },
                ],
              },
            ],
            subscriptionPlan: {
              id: "plan-1",
              label: "Quarterly retainer",
              billingCycle: "quarterly",
              priceMultiplier: 0.9,
              priceDelta: null,
            },
          },
          attributes: {
            customFields: [{ id: "field-username", label: "Instagram handle", value: "@smplat" }],
          },
        },
      ],
      providerOrders: [
        {
          id: "prov-order-1",
          providerId: "vendor-1",
          providerName: "Growth Vendor",
          serviceId: "svc-profile",
          serviceAction: "order",
          orderId: "order-1",
          orderItemId: "item-1",
          amount: 90,
          currency: "USD",
          providerOrderId: "remote-123",
          refills: [
            {
              id: "ref-1",
              amount: 40,
              currency: "USD",
              performedAt: "2025-01-02T00:00:00.000Z",
            },
          ],
          replays: [
            { id: "replay-1", status: "executed", performedAt: "2025-01-02T01:00:00.000Z" },
          ],
          scheduledReplays: [
            { id: "sched-1", status: "scheduled", scheduledFor: "2025-01-03T00:00:00.000Z" },
          ],
          payload: {
            providerOrderId: "remote-123",
            refills: [
              {
                id: "ref-1",
                amount: 40,
                currency: "USD",
                performedAt: "2025-01-02T00:00:00.000Z",
              },
            ],
            replays: [
              { id: "replay-1", status: "executed", performedAt: "2025-01-02T01:00:00.000Z" },
            ],
            scheduledReplays: [
              { id: "sched-1", status: "scheduled", scheduledFor: "2025-01-03T00:00:00.000Z" },
            ],
          },
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:05:00.000Z",
        },
      ],
    };

    const order = mapOrderPayload(payload);
    expect(order.items).toHaveLength(1);
    expect(order.providerOrders).toHaveLength(1);
    expect(order.providerOrders?.[0]).toMatchObject({
      providerId: "vendor-1",
      providerOrderId: "remote-123",
    });
    expect(order.providerOrders?.[0]?.refills).toHaveLength(1);
    expect(order.providerOrders?.[0]?.replays).toHaveLength(1);
    expect(order.providerOrders?.[0]?.scheduledReplays).toHaveLength(1);
    const [item] = order.items;

    expect(item.selectedOptions).not.toBeNull();
    expect(item.selectedOptions?.options).toHaveLength(1);
    expect(item.selectedOptions?.options?.[0]).toMatchObject({
      marketingTagline: "100 followers / €3",
      fulfillmentSla: "72h turnaround",
      heroImageUrl: "https://cdn.example.com/hero.png",
    });
    expect(item.selectedOptions?.options?.[0]?.calculator).toMatchObject({
      expression: "amount / days",
      sampleAmount: 100,
      sampleDays: 5,
      sampleResult: 20,
    });
    expect(item.selectedOptions?.addOns?.[0]).toMatchObject({
      id: "addon-1",
      pricingMode: "flat",
      pricingAmount: 30,
      payloadTemplate: { geo: "eu" },
      previewQuantity: 150,
      providerCostAmount: 45,
      providerCostCurrency: "USD",
      marginTarget: 0.22,
      serviceRules: [
        {
          id: "rule-boost",
          conditions: [{ kind: "channel", channels: ["storefront"] }],
          overrides: { providerId: "vendor-99" },
        },
      ],
    });
    expect(item.selectedOptions?.subscriptionPlan).toMatchObject({
      id: "plan-1",
      billingCycle: "quarterly",
      priceMultiplier: 0.9,
    });
  });
});
