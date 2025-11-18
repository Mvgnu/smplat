import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CheckoutTrustExperience } from "@/server/cms/trust";

const mockQueueCheckoutIntents = jest.fn(() => []);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>
}));

jest.mock("@/store/cart", () => {
  let mockItems: Array<Record<string, unknown>> = [];
  let mockClear = jest.fn();

  const useCartStore = jest.fn((selector: (state: { items: typeof mockItems; clear: typeof mockClear }) => unknown) =>
    selector({
      items: mockItems,
      clear: mockClear
    })
  );
  const cartTotalSelector = (state: { items: typeof mockItems }) =>
    state.items.reduce((acc, item: Record<string, unknown>) => {
      const unitPrice = typeof item.unitPrice === "number" ? item.unitPrice : 0;
      const quantity = typeof item.quantity === "number" ? item.quantity : 0;
      return acc + unitPrice * quantity;
    }, 0);

  return {
    __esModule: true,
    cartTotalSelector,
    useCartStore,
    __setMockCartState: (nextState: { items: typeof mockItems; clear: typeof mockClear }) => {
      mockItems = nextState.items;
      mockClear = nextState.clear;
    }
  };
});

jest.mock("@/lib/loyalty/intents", () => ({
  clearResolvedIntents: jest.fn(),
  consumeSuccessIntents: jest.fn(() => []),
  persistServerFeed: jest.fn(),
  queueCheckoutIntents: (...args: unknown[]) => mockQueueCheckoutIntents(...args)
}));

const { __setMockCartState } = jest.requireMock("@/store/cart");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CheckoutPageClient } = require("../checkout.client");

const mockTrustContent: CheckoutTrustExperience = {
  slug: "checkout",
  guaranteeHeadline: "Guaranteed",
  guaranteeDescription: "You are covered.",
  assurances: [],
  supportChannels: [],
  performanceSnapshots: [],
  testimonials: [
    {
      id: "test",
      quote: "Great",
      author: "Ops",
      role: "Lead"
    }
  ],
  bundleOffers: [],
  deliveryTimeline: {
    id: "delivery",
    headline: "Delivery window",
    fallbackMinMinutes: 60 * 24,
    fallbackMaxMinutes: 60 * 72,
    fallbackAverageMinutes: 60 * 48,
    fallbackConfidence: "Forecast"
  }
};

describe("CheckoutPageClient loyalty projection", () => {
  const originalFetch = global.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockItems = [
      {
        id: "cart-1",
        productId: "prod-1",
        slug: "custom-service",
        title: "Custom Service",
        currency: "USD",
        basePrice: 1000,
        quantity: 2,
        unitPrice: 1000,
        selectedOptions: [],
        addOns: [],
        customFields: [],
        experience: {
          slug: "custom-service",
          name: "Custom Service",
          category: "Growth",
          journeyInsight: "Fast track",
          trustSignal: { value: "4.6 days", label: "Median delivery" },
          loyaltyHint: {
            value: "Earn 800 pts",
            reward: "Bonus audit",
            progress: 0.5,
            pointsEstimate: 800
          },
          highlights: [{ id: "hl-1", label: "Priority ops" }],
          sla: "5 days"
        }
      }
    ];
    __setMockCartState({
      items: mockItems,
      clear: jest.fn()
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error assigning partial location for test env
    delete window.location;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error jest environment override
    window.location = {
      href: "https://example.com/checkout",
      origin: "https://example.com"
    };
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // @ts-expect-error cleanup
      delete global.fetch;
    }
    window.location = originalLocation;
  });

  it("surfaces projected points in UI and checkout payload", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo) => {
      if (typeof input === "string" && input.includes("/api/v1/loyalty/tiers")) {
        return {
          ok: true,
          json: async () => []
        } as Response;
      }
      if (input === "/api/checkout") {
        return {
          ok: true,
          json: async () => ({
            order: { id: "order-123" },
            payment: { checkout_url: "https://payments.example/checkout" }
          })
        } as Response;
      }
      throw new Error(`Unhandled fetch for ${input.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <CheckoutPageClient
        trustContent={mockTrustContent}
        loyaltyMember={null}
        loyaltyRewards={[]}
        pricingExperiments={[]}
      />
    );

    const nameInput = await screen.findByTestId("name-input");
    fireEvent.change(nameInput, { target: { value: "Ada Lovelace" } });
    const emailInput = await screen.findByTestId("email-input");
    fireEvent.change(emailInput, { target: { value: "ada@example.com" } });

    expect(
      screen.getByText("This cart will earn approximately 1,600 pts.", { exact: false })
    ).toBeInTheDocument();

    const form = nameInput.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/checkout", expect.any(Object));
    });

    const checkoutCall = fetchMock.mock.calls.find(([url]) => url === "/api/checkout");
    expect(checkoutCall).toBeTruthy();
    const payload = JSON.parse(checkoutCall![1].body as string);

    expect(payload.journeyContext.loyaltyProjection.projectedPoints).toBe(1600);
    expect(payload.journeyContext.cart[0].pointsTotal).toBe(1600);
    expect(payload.journeyContext.cart[0].loyaltyHint.pointsEstimate).toBe(800);
  });

  it("logs pricing experiment conversions before invoking checkout", async () => {
    const experiment = {
      slug: "spring-offer",
      name: "Spring offer",
      description: null,
      status: "running",
      targetProductSlug: "custom-service",
      targetSegment: null,
      featureFlagKey: null,
      assignmentStrategy: "sequential",
      variants: [
        {
          key: "control",
          name: "Control",
          description: null,
          weight: 50,
          isControl: true,
          adjustmentKind: "delta",
          priceDeltaCents: 0,
          priceMultiplier: null,
          metrics: [],
        },
        {
          key: "variant-a",
          name: "Variant A",
          description: null,
          weight: 50,
          isControl: false,
          adjustmentKind: "delta",
          priceDeltaCents: -1500,
          priceMultiplier: null,
          metrics: [],
        },
      ],
      provenance: {},
    };

    const fetchMock = jest.fn(async (input: RequestInfo) => {
      if (typeof input === "string" && input.includes("/api/v1/loyalty/tiers")) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (input === "/api/catalog/pricing-experiments/events") {
        return {
          ok: true,
          json: async () => ({ recorded: 1 }),
        } as Response;
      }
      if (input === "/api/checkout") {
        return {
          ok: true,
          json: async () => ({
            order: { id: "order-123" },
            payment: { checkout_url: "https://payments.example/checkout" },
          }),
        } as Response;
      }
      throw new Error(`Unhandled fetch for ${input.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <CheckoutPageClient
        trustContent={mockTrustContent}
        loyaltyMember={null}
        loyaltyRewards={[]}
        pricingExperiments={[experiment as any]}
      />,
    );

    const nameInput = await screen.findByTestId("name-input");
    fireEvent.change(nameInput, { target: { value: "Ada Lovelace" } });
    const emailInput = await screen.findByTestId("email-input");
    fireEvent.change(emailInput, { target: { value: "ada@example.com" } });

    const form = nameInput.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/catalog/pricing-experiments/events", expect.any(Object));
    });

    const eventsCall = fetchMock.mock.calls.find(([url]) => url === "/api/catalog/pricing-experiments/events");
    expect(eventsCall).toBeTruthy();
    const eventPayload = JSON.parse(eventsCall![1].body as string);
    expect(eventPayload.events).toEqual([
      {
        slug: "spring-offer",
        variantKey: "variant-a",
        conversions: 2,
        revenueCents: 200000,
      },
    ]);

    const checkoutCall = fetchMock.mock.calls.find(([url]) => url === "/api/checkout");
    expect(checkoutCall).toBeTruthy();
    const checkoutPayload = JSON.parse(checkoutCall![1].body as string);
    expect(checkoutPayload.order.items[0].attributes.pricingExperiment).toEqual({
      slug: "spring-offer",
      name: "Spring offer",
      variantKey: "variant-a",
      variantName: "Variant A",
      isControl: false,
      assignmentStrategy: "sequential",
      status: "running",
      featureFlagKey: null,
    });
  });
});

describe("CheckoutPageClient pricing experiments", () => {
  it("shows dynamic pricing context when experiments target items", () => {
    const experiment = {
      slug: "spring-offer",
      name: "Spring offer",
      description: null,
      status: "running",
      targetProductSlug: "custom-service",
      targetSegment: null,
      featureFlagKey: null,
      assignmentStrategy: "sequential",
      variants: [
        {
          key: "control",
          name: "Control",
          description: null,
          weight: 50,
          isControl: true,
          adjustmentKind: "delta",
          priceDeltaCents: 0,
          priceMultiplier: null,
          metrics: [],
        },
        {
          key: "variant-a",
          name: "Variant A",
          description: null,
          weight: 50,
          isControl: false,
          adjustmentKind: "delta",
          priceDeltaCents: -1500,
          priceMultiplier: null,
          metrics: [],
        },
      ],
      provenance: {},
    };

    render(
      <CheckoutPageClient
        trustContent={mockTrustContent}
        loyaltyMember={null}
        loyaltyRewards={[]}
        pricingExperiments={[experiment]}
      />
    );

    expect(screen.getByText("Dynamic pricing trial")).toBeInTheDocument();
    expect(screen.getByText("Variant A")).toBeInTheDocument();
  });
});
