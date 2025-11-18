import type { MetricValidationResult } from "@/types/metrics";
import { validateSocialAccount } from "@/server/metrics/metric-sourcer";

const originalEnv = process.env;

describe("validateSocialAccount", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, CHECKOUT_API_KEY: "metric-key", API_BASE_URL: "https://api.test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    // @ts-expect-error reset mock
    global.fetch = undefined;
  });

  it("posts payload to the FastAPI endpoint and sanitizes the response", async () => {
    const responseBody: MetricValidationResult = {
      account: {
        id: "acct-1",
        platform: "instagram",
        handle: "brand",
        displayName: "Brand",
        profileUrl: "https://instagram.com/brand",
        avatarUrl: "https://cdn.test/avatar.jpg",
        verificationStatus: "verified",
        verificationMethod: null,
        verificationNotes: null,
        lastVerifiedAt: "2024-01-01T00:00:00.000Z",
        lastScrapedAt: "2024-01-01T00:00:00.000Z",
        baselineMetrics: { foo: "bar" },
        deliverySnapshots: { latest: {} },
        targetMetrics: null,
        metadata: { note: "ok" },
        customerProfileId: null,
      },
      snapshot: {
        platform: "instagram",
        handle: "brand",
        metrics: { followerCount: 100 },
        scrapedAt: "2024-01-01T00:00:00.000Z",
        source: "scraper",
        qualityScore: 0.9,
        latencyMs: 200,
        warnings: ["sample"],
        metadata: { raw: true },
        accountId: "acct-1",
        displayName: "Brand",
        profileUrl: "https://instagram.com/brand",
        avatarUrl: "https://cdn.test/avatar.jpg",
      },
      created: true,
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
      text: async () => "",
    });
    // @ts-expect-error test stub
    global.fetch = fetchMock;

    const result = await validateSocialAccount({
      platform: "instagram",
      handle: "@Brand ",
      manualMetrics: { followers: 1000 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/metrics/accounts/validate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "metric-key",
        }),
      }),
    );
    expect(result.account.handle).toBe("brand");
    expect(result.snapshot.metrics).toHaveProperty("followerCount", 100);
  });

  it("throws when the API responds with an error", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    });
    // @ts-expect-error test stub
    global.fetch = fetchMock;

    await expect(
      validateSocialAccount({ platform: "tiktok", handle: "creator" }),
    ).rejects.toThrow(/unavailable/);
  });
});
