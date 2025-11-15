import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockGetCheckoutTrustExperience = jest.fn();
const mockFetchProductDetail = jest.fn();

jest.mock("@/server/cms/trust", () => ({
  getCheckoutTrustExperience: (...args: unknown[]) => mockGetCheckoutTrustExperience(...args)
}));

jest.mock("@/server/catalog/products", () => ({
  fetchProductDetail: (...args: unknown[]) => mockFetchProductDetail(...args)
}));

describe("getStorefrontExperience cache", () => {
  let now = 1_000;
  let dateSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    mockGetCheckoutTrustExperience.mockReset();
    mockFetchProductDetail.mockReset();
    now = 1_000;
    dateSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("returns cached storefront experience on repeat calls within ttl", async () => {
    const mockTrustExperience = {
      slug: "default",
      guaranteeHeadline: "Guarantee",
      guaranteeDescription: "desc",
      assurances: [],
      supportChannels: [],
      performanceSnapshots: [],
      testimonials: [],
      bundleOffers: [],
      deliveryTimeline: {
        id: "timeline",
        headline: "timeline"
      }
    };
    mockGetCheckoutTrustExperience.mockResolvedValue(mockTrustExperience);
    mockFetchProductDetail.mockResolvedValue(null);

    await jest.isolateModulesAsync(async () => {
      const { getStorefrontExperience } = await import("../experience");

      const first = await getStorefrontExperience(null);
      expect(mockGetCheckoutTrustExperience).toHaveBeenCalledTimes(1);
      expect(mockFetchProductDetail).toHaveBeenCalled();

      mockFetchProductDetail.mockClear();
      mockGetCheckoutTrustExperience.mockClear();

      now = 1_500;

      const second = await getStorefrontExperience(null);

      expect(second).toBe(first);
      expect(mockGetCheckoutTrustExperience).not.toHaveBeenCalled();
      expect(mockFetchProductDetail).not.toHaveBeenCalled();
    });
  });
});
