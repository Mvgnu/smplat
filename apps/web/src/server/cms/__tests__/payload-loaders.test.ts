import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import homepageFixture from "../__fixtures__/payload-homepage.json";

type FetchArgs = Parameters<typeof fetch>;

type MockResponseInit = {
  ok?: boolean;
  status?: number;
  statusText?: string;
};

const createResponse = (body: unknown, init: MockResponseInit = {}) => {
  const { ok = true, status = 200, statusText = "OK" } = init;
  return {
    ok,
    status,
    statusText,
    json: async () => body
  } as Response;
};

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

describe("payload client", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.CMS_PROVIDER = "payload";
    process.env.CMS_ENV = "test";
    process.env.PAYLOAD_URL = "https://payload.test";
    process.env.PAYLOAD_API_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      (global as typeof global & { fetch?: typeof fetch }).fetch = undefined;
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("attaches auth headers, query params, and parses json", async () => {
    const fetchMock = jest.fn(async (url: FetchArgs[0], init: FetchArgs[1]) => {
      expect(url).toBe(
        "https://payload.test/api/pages?where%5Bslug%5D%5Bequals%5D=home&depth=2&filter=a&filter=b"
      );
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: "Bearer test-token"
      });
      return createResponse({ result: "ok" });
    }) as jest.MockedFunction<(...args: FetchArgs) => Promise<Response>>;

    global.fetch = fetchMock as unknown as typeof fetch;

    const { payloadFetch } = await import("../client");

    const result = await payloadFetch<{ result: string }>({
      path: "/api/pages",
      query: {
        "where[slug][equals]": "home",
        depth: 2,
        filter: ["a", "b"],
        optional: undefined,
        skip: null
      }
    });

    expect(result).toEqual({ result: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries failed requests before succeeding", async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(createResponse({}, { ok: false, status: 500, statusText: "Server Error" }))
      .mockResolvedValueOnce(createResponse({ done: true }));
    const onRetry = jest.fn();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { payloadFetch, PayloadRequestError } = await import("../client");

    const promise = payloadFetch<{ done: boolean }>({
      path: "/api/pages",
      retries: 2,
      retryDelayMs: 10,
      onRetry
    });

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(PayloadRequestError));
    warnSpy.mockRestore();
  });

  it("throws the final error after exhausting retries", async () => {
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse({}, { ok: false, status: 503, statusText: "Unavailable" }));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { payloadFetch, PayloadRequestError } = await import("../client");

    await expect(
      payloadFetch({
        path: "/api/pages",
        retries: 1
      })
    ).rejects.toBeInstanceOf(PayloadRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("payload loaders", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.CMS_PROVIDER = "payload";
    process.env.CMS_ENV = "test";
    process.env.PAYLOAD_URL = "https://payload.test";
    process.env.PAYLOAD_API_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      (global as typeof global & { fetch?: typeof fetch }).fetch = undefined;
    }
    jest.clearAllMocks();
  });

  it("normalises payload homepage responses", async () => {
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse(homepageFixture));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchHomepage } = await import("../loaders");

    const page = await fetchHomepage();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://payload.test/api/pages?where%5Bslug%5D%5Bequals%5D=home&where%5Benvironment%5D%5Bequals%5D=test&depth=2&limit=1",
      expect.objectContaining({ method: "GET" })
    );

    expect(page).toMatchObject({
      _id: "home-test-id",
      title: "Home",
      hero: {
        eyebrow: "Social Media Growth",
        headline: "Launch your storefront",
        subheadline: "Automate delivery",
        cta: {
          href: "#contact",
          label: "Book a demo"
        }
      },
      content: [
        {
          _type: "section",
          _key: "section-hero",
          heading: "Built for agencies",
          subheading: "Operational excellence",
          layout: "metrics",
          metrics: [
            { label: "Campaigns launched", value: "1200+", description: "Across paid & organic" },
            { label: "Average ROI", value: "3.4x" },
            { label: "Retention", value: "92%", description: "Annual client retention" }
          ],
          faqItems: [
            { question: "How fast can we launch?", answer: "Most teams ship in 3 weeks", category: "Getting Started" },
            { question: "Do you support retainers?", answer: "Yes, billing is built-in" }
          ],
          testimonials: [
            {
              quote: "SMPLAT keeps our pipeline full.",
              author: "Rowan James",
              role: "COO",
              company: "Growth Syndicate",
              avatarUrl: "https://example.com/avatar-rowan.png"
            }
          ],
          caseStudy: {
            title: "Driving ROI",
            client: "Northwind Social",
            industry: "Retail",
            summary: "Optimised fulfillment and reporting.",
            results: [
              { label: "ROI uplift", value: "4.2x" },
              { label: "New retainers", value: "8" }
            ],
            quote: "Our ops team finally scales.",
            quoteAuthor: "Jamie Patel"
          },
          pricingTiers: [
            {
              name: "Starter",
              description: "Launch playbooks",
              price: 149,
              currency: "EUR",
              features: ["Hosted storefront", "Stripe billing"],
              ctaLabel: "Start",
              ctaHref: "#start",
              highlight: false
            },
            {
              name: "Growth",
              description: "Scale automation",
              price: 349,
              currency: "EUR",
              features: ["Automation", "Reporting"],
              ctaLabel: "Talk to sales",
              ctaHref: "#sales",
              highlight: true
            }
          ],
          blogPosts: [
            {
              title: "Onboarding playbook",
              slug: { current: "onboarding-playbook" },
              excerpt: "Standardise intake and delivery.",
              publishedAt: "2023-11-01T00:00:00.000Z"
            },
            {
              title: "Automation workflows",
              slug: { current: "automation-workflows" },
              excerpt: "Keep campaigns moving",
              publishedAt: "2023-11-03T00:00:00.000Z"
            }
          ]
        },
        {
          _type: "testimonial",
          _key: "testimonial-block",
          quote: "SMPLAT freed our strategists to focus on growth.",
          author: "Alex Rivera",
          role: "Founder",
          company: "Signal Boost",
          avatarUrl: "https://example.com/avatar-alex.png"
        }
      ],
      seoTitle: "SMPLAT — Social media storefront",
      seoDescription: "Purpose-built storefront for agencies"
    });
    warnSpy.mockRestore();
  });
});
