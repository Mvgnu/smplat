import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import CheckoutSuccessPage from "../success/page";

const searchParamsGet = jest.fn((key: string) => {
  if (key === "order") {
    return "order-123";
  }
  return null;
});

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsGet(key)
  })
}));

jest.mock("@/store/cart", () => ({
  useCartStore: (selector: (state: { clear: () => void }) => unknown) => selector({ clear: () => undefined })
}));

jest.mock("@/components/loyalty/nudge-rail", () => ({
  LoyaltyNudgeRail: () => <div data-testid="nudge-rail">nudge</div>
}));

jest.mock("@/components/checkout/recovery-banner", () => ({
  CheckoutRecoveryBanner: () => <div data-testid="recovery-banner">recovery</div>
}));

jest.mock("@/components/orders/copy-receipt-link-button", () => ({
  CopyReceiptLinkButton: () => <span data-testid="copy-link">copy</span>
}));

jest.mock("@/context/storefront-state", () => ({
  usePlatformSelection: () => null
}));

describe("CheckoutSuccessPage loyalty projection banner", () => {
  const originalFetch = global.fetch;

  const createFetchMock = (orderSummary: Record<string, unknown>) =>
    jest.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url ?? "";
      if (url.startsWith("/api/orders/")) {
        return {
          ok: true,
          json: async () => orderSummary
        } as Response;
      }
      if (url.startsWith("/api/checkout/orchestrations/")) {
        return {
          ok: true,
          json: async () => ({ runs: [] })
        } as Response;
      }
      if (url.startsWith("/api/onboarding/journeys/")) {
        return {
          ok: true,
          json: async () => ({ status: "active", referral_code: null, tasks: [] })
        } as Response;
      }
      if (url.startsWith("/api/analytics/")) {
        return {
          ok: true,
          json: async () => ({})
        } as Response;
      }
      if (url.startsWith("/api/loyalty/checkout-intents")) {
        return {
          ok: true,
          json: async () => []
        } as Response;
      }
      if (url.startsWith("/api/loyalty/next-actions")) {
        return {
          ok: true,
          json: async () => ({ intents: [] })
        } as Response;
      }
      if (url.startsWith("/api/loyalty/nudges")) {
        return {
          ok: true,
          json: async () => ({ cards: [] })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({})
      } as Response;
    }) as typeof fetch;

  beforeEach(() => {
    const orderSummary = {
      id: "order-123",
      orderNumber: "SM123",
      currency: "USD",
      total: 1000,
      createdAt: "2024-05-01T00:00:00.000Z",
      updatedAt: "2024-05-01T00:05:00.000Z",
      notes: null,
      loyaltyProjectionPoints: 2400,
      items: [],
      pricingExperiments: [],
      deliveryProof: null,
      deliveryProofAggregates: null,
    };

    global.fetch = createFetchMock(orderSummary);
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // @ts-expect-error cleanup for node environment
      delete global.fetch;
    }
    jest.clearAllMocks();
  });

  it("shows loyalty projection banner once order summary loads without projectedPoints query param", async () => {
    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(
        screen.getByText("This order earned approximately 2,400 loyalty points.")
      ).toBeInTheDocument()
    );
  });

  it("shows fallback text when no projection data exists", async () => {
    const fallbackOrderSummary = {
      id: "order-123",
      orderNumber: "SM123",
      currency: "USD",
      total: 1000,
      createdAt: "2024-05-01T00:00:00.000Z",
      updatedAt: "2024-05-01T00:05:00.000Z",
      notes: null,
      loyaltyProjectionPoints: null,
      items: [],
      pricingExperiments: [],
      deliveryProof: null,
      deliveryProofAggregates: null,
    };

    global.fetch = createFetchMock(fallbackOrderSummary);

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Loyalty projection will appear here shortly after checkout. You can still review your receipt below."
        )
      ).toBeInTheDocument()
    );
  });

  it("surfaces pricing experiment insights and emits analytics events", async () => {
    const experimentSummary = {
      id: "order-123",
      orderNumber: "SM123",
      currency: "USD",
      total: 1000,
      createdAt: "2024-05-01T00:00:00.000Z",
      updatedAt: "2024-05-01T00:05:00.000Z",
      notes: null,
      loyaltyProjectionPoints: 1200,
      items: [
        {
          id: "item-1",
          productId: null,
          productTitle: "Custom Service",
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          selectedOptions: null,
          attributes: {
            pricingExperiment: {
              slug: "spring-offer",
              name: "Spring offer",
              variantKey: "variant-a",
              variantName: "Variant A",
              isControl: false,
              assignmentStrategy: "sequential",
              status: "running",
              featureFlagKey: null,
            },
          },
        },
      ],
      pricingExperiments: [
        {
          slug: "spring-offer",
          name: "Spring offer",
          variantKey: "variant-a",
          variantName: "Variant A",
          isControl: false,
          assignmentStrategy: "sequential",
          status: "running",
          featureFlagKey: null,
        },
      ],
      deliveryProof: null,
      deliveryProofAggregates: null,
    };

    const fetchMock = createFetchMock(experimentSummary);
    global.fetch = fetchMock;

    render(<CheckoutSuccessPage />);

    await waitFor(() => {
      expect(screen.getByText("Pricing experiment insights")).toBeInTheDocument();
    });
    expect(screen.getByText("Spring offer")).toBeInTheDocument();
    expect(screen.getAllByText("Variant A")[0]).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("Challenger cohort") && content.includes("running")),
    ).toBeInTheDocument();
    expect(screen.getByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("Download PDF")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/onboarding-events",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  it("renders platform context chips for order items", async () => {
    const platformSummary = {
      id: "order-789",
      orderNumber: "SM789",
      currency: "USD",
      total: 500,
      createdAt: "2024-06-01T00:00:00.000Z",
      updatedAt: "2024-06-01T00:05:00.000Z",
      notes: null,
      loyaltyProjectionPoints: null,
      items: [
        {
          id: "item-ctx",
          productId: "prod-ctx",
          productTitle: "TikTok Sprint",
          quantity: 1,
          unitPrice: 500,
          totalPrice: 500,
          selectedOptions: null,
          attributes: null,
          platformContext: {
            id: "tiktok::@brand",
            label: "TikTok",
            handle: "@brand",
            platformType: "tiktok",
          },
        },
      ],
      pricingExperiments: [],
      deliveryProof: null,
      deliveryProofAggregates: null,
    };

    global.fetch = createFetchMock(platformSummary);

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(screen.getByText("TikTok • @brand • tiktok")).toBeInTheDocument()
    );
  });

  it("renders delivery proof insights when metrics are available", async () => {
    const now = "2024-05-05T12:00:00.000Z";
    const deliverySummary = {
      id: "order-321",
      orderNumber: "SM321",
      currency: "USD",
      total: 750,
      createdAt: now,
      updatedAt: now,
      notes: null,
      loyaltyProjectionPoints: null,
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          productTitle: "Instagram Growth",
          quantity: 1,
          unitPrice: 750,
          totalPrice: 750,
          selectedOptions: null,
          attributes: null,
          platformContext: {
            id: "ig::@demo",
            label: "Instagram",
            handle: "@demo",
            platformType: "instagram",
          },
        },
      ],
      pricingExperiments: [],
      deliveryProof: {
        orderId: "order-321",
        generatedAt: now,
        items: [
          {
            itemId: "item-1",
            productTitle: "Instagram Growth",
            platformContext: null,
            account: {
              id: "acct-1",
              handle: "demo",
              platform: "instagram",
              displayName: "Demo",
              verificationStatus: "verified",
              lastVerifiedAt: now,
              metadata: {},
            },
            baseline: {
              metrics: { followerCount: 1000 },
              recordedAt: now,
              source: "scraper",
              warnings: [],
            },
            latest: {
              metrics: { followerCount: 1200 },
              recordedAt: now,
              source: "scraper",
              warnings: [],
            },
            history: [],
          },
        ],
      },
      deliveryProofAggregates: {
        generatedAt: now,
        windowDays: 90,
        products: [
          {
            productId: "prod-1",
            productSlug: "instagram-growth",
            productTitle: "Instagram Growth",
            sampleSize: 12,
            platforms: ["instagram"],
            lastSnapshotAt: now,
            metrics: [
              {
                metricId: "delivery_proof/instagram-growth/followerCount",
                metricKey: "followerCount",
                sampleSize: 12,
                formattedDelta: "+1.2k",
                formattedLatest: "18k",
                formattedPercent: "+12%",
              },
            ],
          },
        ],
      },
    };

    global.fetch = createFetchMock(deliverySummary);

    render(<CheckoutSuccessPage />);

    await waitFor(() => expect(screen.getByText("Delivery proof insights")).toBeInTheDocument());
    expect(screen.getAllByText("Instagram Growth").length).toBeGreaterThan(0);
    expect(screen.getByText("+200")).toBeInTheDocument();
    expect(screen.getByText(/Benchmark \+1\.2k/)).toBeInTheDocument();
  });
});
