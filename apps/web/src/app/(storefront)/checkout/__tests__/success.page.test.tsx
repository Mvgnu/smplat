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
      items: []
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
      items: []
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
});
