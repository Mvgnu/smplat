import React from "react";
import { TextEncoder, TextDecoder } from "node:util";

import type { AdminOrder } from "@/server/orders/admin-orders";
import type { DeliveryProofAggregateResponse, OrderDeliveryProof } from "@/types/delivery-proof";
import AccountOrdersPage from "../page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(() => Promise.resolve()),
  }),
}));

// jsdom lacks TextEncoder/TextDecoder when rendering server components. Polyfill them.
if (typeof global.TextEncoder === "undefined") {
  // @ts-expect-error assigning polyfill for Jest environment
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  // @ts-expect-error assigning polyfill for Jest environment
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

const mockRequireRole = jest.fn();
const mockFetchClientOrderHistory = jest.fn();
const mockFetchReceiptStorageComponent = jest.fn();
const mockFetchGuardrailWorkflowTelemetrySummary = jest.fn();

jest.mock("@/server/auth/policies", () => ({
  requireRole: (input: unknown) => mockRequireRole(input)
}));

jest.mock("@/server/orders/client-orders", () => ({
  fetchClientOrderHistory: (...args: unknown[]) => mockFetchClientOrderHistory(...args)
}));

jest.mock("@/server/health/readiness", () => ({
  fetchReceiptStorageComponent: (...args: unknown[]) => mockFetchReceiptStorageComponent(...args)
}));

jest.mock("@/server/reporting/guardrail-workflow-telemetry", () => ({
  fetchGuardrailWorkflowTelemetrySummary: (...args: unknown[]) =>
    mockFetchGuardrailWorkflowTelemetrySummary(...args)
}));
jest.mock("@/components/account/QuickOrderWorkflowTelemetry.client", () => ({
  QuickOrderWorkflowTelemetry: ({ initialTelemetry }: { initialTelemetry: unknown }) => (
    <div data-testid="workflow-telemetry">{initialTelemetry ? "Telemetry ready" : "No telemetry"}</div>
  )
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
    mockFetchReceiptStorageComponent.mockReset();
    mockFetchReceiptStorageComponent.mockResolvedValue(null);
    mockFetchGuardrailWorkflowTelemetrySummary.mockReset();
    mockFetchGuardrailWorkflowTelemetrySummary.mockResolvedValue(null);
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
          attributes: {
            pricingExperiment: {
              slug: "spring-offer",
              name: "Spring offer",
              variantKey: "variant-a",
              variantName: "Variant A",
              isControl: false,
              assignmentStrategy: "sequential",
              status: "running",
              featureFlagKey: null
            }
          },
          platformContext: {
            id: "instagram::@brand",
            label: "Instagram",
            handle: null,
            platformType: "instagram"
          }
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

    const html = renderToStaticMarkup(await AccountOrdersPage({ searchParams: {} }));

    expect(html).toContain("Provider automation");
    expect(html).toContain("Growth Vendor");
    expect(html).toContain("Scheduled pending");
    expect(html).toContain("Manual refills");
    expect(html).toContain("This order earned approximately 2,400 loyalty points.");
    expect(html).toContain("Pricing experiments");
    expect(html).toContain("Variant A");
    expect(html).toContain("Instagram • instagram");
    expect(html).toContain("Download PDF");
    expect(mockFetchClientOrderHistory).toHaveBeenCalledWith("user-1", 25, { includeDeliveryProof: true });
    expect(mockFetchReceiptStorageComponent).toHaveBeenCalled();
  });

  it("renders quick-order telemetry card when delivery proof and receipt probe data exist", async () => {
    mockRequireRole.mockResolvedValue({ session: { user: { id: "user-quick" } } });
    const deliveryProof: OrderDeliveryProof = {
      orderId: "order-quick",
      generatedAt: "2024-06-01T12:00:00.000Z",
      items: [
        {
          itemId: "item-quick",
          productTitle: "Boost Campaign",
          platformContext: { label: "Instagram", handle: "@brand", platformType: "instagram" },
          account: {
            id: "acct-1",
            handle: "brand",
            platform: "Instagram",
            displayName: "Brand",
            verificationStatus: "verified",
            lastVerifiedAt: "2024-06-01T11:00:00.000Z",
            metadata: {}
          },
          baseline: { metrics: { followerCount: 1000 }, recordedAt: "2024-05-25T10:00:00.000Z", source: "api", warnings: [] },
          latest: { metrics: { followerCount: 1200 }, recordedAt: "2024-05-31T10:00:00.000Z", source: "api", warnings: [] },
          history: []
        }
      ]
    };
    const aggregates: DeliveryProofAggregateResponse = {
      generatedAt: "2024-06-01T12:00:00.000Z",
      windowDays: 7,
      products: [
        {
          productId: "prod-boost",
          productTitle: "Boost Campaign",
          sampleSize: 12,
          platforms: ["instagram"],
          metrics: [
            {
              metricId: "followers",
              metricKey: "followerCount",
              sampleSize: 12,
              baselineAverage: 1000,
              latestAverage: 1200,
              deltaAverage: 200,
              deltaPercent: 20
            }
          ]
        }
      ]
    };

    const order: AdminOrder = {
      id: "order-quick",
      orderNumber: "SM0100",
      userId: "user-quick",
      status: "completed",
      source: "checkout",
      subtotal: 250,
      tax: 0,
      total: 250,
      currency: "USD",
      notes: null,
      createdAt: "2024-05-31T09:00:00.000Z",
      updatedAt: "2024-06-01T09:00:00.000Z",
      loyaltyProjectionPoints: null,
      items: [
        {
          id: "item-quick",
          productId: "prod-boost",
          productTitle: "Boost Campaign",
          quantity: 1,
          unitPrice: 250,
          totalPrice: 250,
          selectedOptions: null,
          attributes: null,
          platformContext: {
            id: "instagram::@brand",
            label: "Instagram",
            handle: "@brand",
            platformType: "instagram"
          }
        }
      ],
      providerOrders: [],
    };
    mockFetchClientOrderHistory.mockResolvedValue([
      {
        ...order,
        deliveryProof,
        deliveryProofAggregates: aggregates,
      }
    ]);
    mockFetchReceiptStorageComponent.mockResolvedValue({
      status: "ready",
      detail: "Probe healthy",
      lastSuccessAt: "2024-06-01T12:05:00.000Z",
      lastErrorAt: null,
    });
    mockFetchGuardrailWorkflowTelemetrySummary.mockResolvedValue({
      totalEvents: 4,
      lastCapturedAt: "2024-06-01T12:00:00.000Z",
      actionCounts: [{ action: "attachment.upload", count: 2, lastOccurredAt: "2024-06-01T12:00:00.000Z" }],
      attachmentTotals: { upload: 2, remove: 0, copy: 1, tag: 0 },
      providerActivity: [],
    });

    const html = renderToStaticMarkup(await AccountOrdersPage({ searchParams: {} }));

    expect(html).toContain("Quick-order trust snapshot");
    expect(html).toContain("Boost Campaign");
    expect(html).toContain("Probe healthy");
    expect(html).toContain("Start quick order");
    expect(html).toContain("Workflow telemetry");
    expect(mockFetchReceiptStorageComponent).toHaveBeenCalled();
  });

  it("renders delivery proof insights with aggregate fallback", async () => {
    mockRequireRole.mockResolvedValue({ session: { user: { id: "user-2" } } });
    const order: AdminOrder = {
      id: "order-2",
      orderNumber: "SM0002",
      userId: "user-2",
      status: "completed",
      source: "checkout",
      subtotal: 200,
      tax: 0,
      total: 200,
      currency: "USD",
      notes: null,
      createdAt: "2024-05-01T00:00:00.000Z",
      updatedAt: "2024-05-02T00:00:00.000Z",
      loyaltyProjectionPoints: null,
      items: [
        {
          id: "item-2",
          productId: "prod-2",
          productTitle: "Follower Lift",
          quantity: 1,
          unitPrice: 200,
          totalPrice: 200,
          selectedOptions: null,
          attributes: null,
          platformContext: {
            id: "tiktok::@brand",
            label: "TikTok",
            handle: "@brand",
            platformType: "tiktok"
          }
        }
      ],
      providerOrders: []
    } as AdminOrder;

    const deliveryProof: OrderDeliveryProof = {
      orderId: "order-2",
      generatedAt: "2024-05-02T00:00:00.000Z",
      items: [
        {
          itemId: "item-2",
          productTitle: "Follower Lift",
          platformContext: null,
          account: {
            id: "acct-1",
            handle: "brand",
            platform: "tiktok",
            displayName: "Brand TikTok",
            verificationStatus: "verified",
            lastVerifiedAt: "2024-05-02T00:00:00.000Z",
            metadata: {}
          },
          baseline: {
            metrics: { followerCount: 1000 },
            recordedAt: "2024-04-01T00:00:00.000Z",
            source: "scraper",
            warnings: []
          },
          latest: {
            metrics: { followerCount: 1500 },
            recordedAt: "2024-05-02T00:00:00.000Z",
            source: "scraper",
            warnings: []
          },
          history: []
        }
      ]
    };

    const aggregates: DeliveryProofAggregateResponse = {
      generatedAt: "2024-05-02T00:00:00.000Z",
      windowDays: 30,
      products: [
        {
          productId: "prod-2",
          productSlug: "follower-lift",
          productTitle: "Follower Lift",
          sampleSize: 8,
          platforms: ["tiktok"],
          lastSnapshotAt: "2024-05-02T00:00:00.000Z",
          metrics: [
            {
              metricId: "delivery_proof/follower-lift/followerCount",
              metricKey: "followerCount",
              sampleSize: 8,
              formattedDelta: "+480",
              formattedPercent: "+12%",
              formattedLatest: "18k"
            }
          ]
        }
      ]
    };

    mockFetchClientOrderHistory.mockResolvedValue([
      { ...order, deliveryProof, deliveryProofAggregates: aggregates }
    ]);

    const html = renderToStaticMarkup(await AccountOrdersPage({ searchParams: {} }));

    expect(html).toContain("Delivery proof");
    expect(html).toContain("Follower Lift");
    expect(html).toContain("+500");
    expect(html).toContain("Sample n=8 · 30-day window");
  });
});
