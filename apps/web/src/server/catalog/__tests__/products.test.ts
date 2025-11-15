import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
}

describe("fetchProductDetail cache", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let now = 1_000;
  let dateSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.CHECKOUT_API_KEY = "test-key";
    now = 1_000;
    dateSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      // @ts-expect-error - cleanup when fetch was undefined
      delete globalThis.fetch;
    }
    dateSpy.mockRestore();
  });

  it("returns cached structured clone for repeated calls within ttl", async () => {
    const mockApiPayload = {
      id: "prod-1",
      slug: "prod-1",
      title: "Growth Kit",
      category: "Growth",
      basePrice: 1200,
      currency: "USD",
      status: "active",
      channelEligibility: ["checkout"],
      updatedAt: "2024-01-01T00:00:00.000Z",
      description: "desc",
      optionGroups: [],
      addOns: [],
      customFields: [],
      subscriptionPlans: [],
      fulfillmentSummary: {
        delivery: {
          minDays: 2,
          maxDays: 7,
          averageDays: 4,
          headline: "Rapid launch",
          narrative: "Operators already scheduled.",
          confidence: "High"
        }
      },
      mediaAssets: [],
      configurationPresets: [],
      auditLog: []
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiPayload
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { fetchProductDetail } = await import("../products");

    const first = await fetchProductDetail("prod-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBeTruthy();

    now = 20_000;

    const second = await fetchProductDetail("prod-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
