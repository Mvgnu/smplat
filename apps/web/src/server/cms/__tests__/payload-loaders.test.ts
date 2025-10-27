import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import homepageFixture from "../__fixtures__/payload-homepage.json";
import blogPostDetailFixture from "../__fixtures__/payload-blog-post.json";
import blogPostsFixture from "../__fixtures__/payload-blog-posts.json";
import lexicalMarketingFixture from "../__fixtures__/payload-lexical-marketing.json";
import pageFixture from "../__fixtures__/payload-page.json";
import pageDraftFixture from "../__fixtures__/payload-page-draft.json";
import { normalizeMarketingLexicalContent } from "../lexical";
import type { BlogPostSummary, MarketingContentDocument, PageDocument } from "../types";

jest.mock("@/components/marketing/sections", () => {
  const React = require("react");
  return {
    MarketingSections: ({ sections }: { sections?: unknown }) =>
      React.createElement("div", { "data-testid": "marketing-sections", sections }),
    defaultMarketingMetricsFallback: []
  };
});

const {
  collectMarketingPreviewSnapshots,
  collectMarketingPreviewSnapshotTimeline
} = require("../preview") as typeof import("../preview");

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

const lexicalState = lexicalMarketingFixture as unknown;

type SectionBlock = Extract<NonNullable<PageDocument["content"]>[number], { _type: "section" }>;

const createLexicalSection = (): SectionBlock => {
  const normalized = normalizeMarketingLexicalContent(lexicalState, {
    sectionLabel: "preview-fixture",
    logger: () => {}
  });
  const marketingContent = normalized.blocks
    .map((block) => block.node as MarketingContentDocument | null)
    .filter((block): block is MarketingContentDocument => Boolean(block));

  return {
    _type: "section",
    _key: "lexical-preview",
    heading: "Preview fixture",
    subheading: "Deterministic marketing content",
    layout: undefined,
    content: lexicalState,
    marketingContent,
    metrics: undefined,
    faqItems: undefined,
    testimonials: undefined,
    caseStudy: undefined,
    pricingTiers: undefined,
    blogPosts: undefined
  } satisfies SectionBlock;
};

const createBlogSection = (): SectionBlock => ({
  _type: "section",
  _key: "blog-preview",
  heading: "Insights",
  subheading: "Latest operator stories",
  layout: "blog",
  content: undefined,
  marketingContent: undefined,
  metrics: undefined,
  faqItems: undefined,
  testimonials: undefined,
  caseStudy: undefined,
  pricingTiers: undefined,
  blogPosts: undefined
});

const baseSections = [createLexicalSection()];
const sectionsWithBlog = [...baseSections, createBlogSection()];
const expectedBlockKinds = (baseSections[0].marketingContent ?? [])
  .map((block) => block?.kind)
  .filter((kind): kind is string => typeof kind === "string");

type PageFactoryOptions = {
  variant: string;
  eyebrow?: string;
  subheadline?: string;
  includeBlog?: boolean;
};

const createPageDocument = (
  slug: string,
  title: string,
  headline: string,
  options: PageFactoryOptions
): PageDocument => ({
  _id: `${slug}-${options.variant}`,
  title,
  hero: {
    eyebrow: options.eyebrow,
    headline,
    subheadline: options.subheadline
  },
  content: options.includeBlog ? sectionsWithBlog : baseSections,
  seoTitle: `${title} – Preview`,
  seoDescription: `Preview snapshot for ${title}.`
});

const homepageVariants = {
  published: createPageDocument("home", "Home", "Launch storefronts faster", {
    variant: "home-published",
    eyebrow: "Published hero",
    subheadline: "Live data preview",
    includeBlog: true
  }),
  draft: createPageDocument("home", "Home", "Preview storefront launch", {
    variant: "home-draft",
    eyebrow: "Draft hero",
    subheadline: "Draft data preview",
    includeBlog: true
  })
};

const marketingPageMap = {
  pricing: {
    published: createPageDocument("pricing", "Pricing", "Transparent pricing", {
      variant: "pricing-published",
      eyebrow: "Pricing",
      subheadline: "Published plan comparison"
    }),
    draft: createPageDocument("pricing", "Pricing", "Draft pricing preview", {
      variant: "pricing-draft",
      eyebrow: "Pricing draft",
      subheadline: "Draft plan comparison"
    })
  },
  campaigns: {
    published: createPageDocument("campaigns", "Campaigns", "Campaign operations", {
      variant: "campaigns-published",
      eyebrow: "Campaigns",
      subheadline: "Published campaign journey"
    }),
    draft: createPageDocument("campaigns", "Campaigns", "Draft campaign journey", {
      variant: "campaigns-draft",
      eyebrow: "Campaigns draft",
      subheadline: "Draft campaign journey"
    })
  },
  operations: {
    published: createPageDocument("operations", "Operations", "Operations blueprint", {
      variant: "operations-published",
      eyebrow: "Operations",
      subheadline: "Published operational story"
    }),
    draft: createPageDocument("operations", "Operations", "Draft operations blueprint", {
      variant: "operations-draft",
      eyebrow: "Operations draft",
      subheadline: "Draft operational story"
    })
  },
  blog: {
    published: createPageDocument("blog", "Blog", "Stories from the field", {
      variant: "blog-published",
      eyebrow: "Blog",
      subheadline: "Published blog hero",
      includeBlog: true
    }),
    draft: createPageDocument("blog", "Blog", "Draft stories from the field", {
      variant: "blog-draft",
      eyebrow: "Blog draft",
      subheadline: "Draft blog hero",
      includeBlog: true
    })
  }
} satisfies Record<string, { published: PageDocument; draft: PageDocument }>;

const blogPosts: BlogPostSummary[] = [
  {
    title: "Deterministic metrics testing",
    slug: { current: "deterministic-metrics" },
    excerpt: "Validates marketing preview coverage.",
    publishedAt: "2024-03-01T12:00:00.000Z"
  },
  {
    title: "Interactive storytelling primitives",
    slug: { current: "storytelling-primitives" },
    excerpt: "Guides, calculators, and journeys for operators.",
    publishedAt: "2024-04-15T12:00:00.000Z"
  }
];

describe("payload client", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.CMS_PROVIDER = "payload";
    process.env.CMS_ENV = "test";
    process.env.PAYLOAD_URL = "https://payload.test";
    process.env.PAYLOAD_API_TOKEN = "test-token";
    process.env.PAYLOAD_PREVIEW_SECRET = "preview-secret";
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
    draftState.isEnabled = false;
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
  it("appends draft params and preview headers when draft mode is enabled", async () => {
    draftState.isEnabled = true;
    const fetchMock = jest.fn(async (url: FetchArgs[0], init: FetchArgs[1]) => {
      expect(url.toString()).toContain("draft=true");
      return createResponse({ result: "ok" });
    }) as jest.MockedFunction<(...args: FetchArgs) => Promise<Response>>;

    global.fetch = fetchMock as unknown as typeof fetch;

    const { payloadFetch } = await import("../client");

    const result = await payloadFetch<{ result: string }>({
      path: "/api/pages",
      query: { "where[slug][equals]": "home" }
    });

    expect(result).toEqual({ result: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string> & { get?: (key: string) => string | null };
    expect(headers).toBeDefined();
    const previewHeader = typeof headers?.get === "function"
      ? headers.get("x-payload-preview")
      : headers?.["x-payload-preview"];
    expect(headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer test-token"
    });
    expect(previewHeader).toBe("preview-secret");
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
    draftState.isEnabled = false;
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

  it("normalises payload marketing pages with nested relationships", async () => {
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse(pageFixture));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { getPageBySlug } = await import("../loaders");

    const page = await getPageBySlug("operations");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://payload.test/api/pages?where%5Bslug%5D%5Bequals%5D=operations&where%5Benvironment%5D%5Bequals%5D=test&depth=2&limit=1",
      expect.objectContaining({ method: "GET" })
    );

    expect(page).toBeTruthy();
    expect(page).toMatchObject({
      title: "Operations",
      hero: expect.objectContaining({ headline: "Deliver outcomes with confidence" }),
      seoTitle: "Operations Playbooks",
      seoDescription: "Automate the delivery pipeline"
    });

    const lexicalSection = page?.content?.find((block) => block._key === "lexical-marketing");
    expect(lexicalSection?.marketingContent).toBeDefined();
    expect(lexicalSection?.marketingContent?.map((node) => node.kind)).toEqual(
      expect.arrayContaining([
        "hero",
        "metrics",
        "testimonial",
        "product",
        "timeline",
        "feature-grid",
        "media-gallery",
        "cta-cluster",
        "comparison-table"
      ])
    );
    const heroBlock = lexicalSection?.marketingContent?.find((node) => node.kind === "hero");
    expect(heroBlock).toMatchObject({ headline: "Launch orchestrated campaigns without the chaos" });

    const blogSection = page?.content?.find((block) => block.layout === "blog");
    expect(blogSection?.blogPosts).toHaveLength(2);
    expect(blogSection?.blogPosts).toEqual(
      expect.arrayContaining([
        {
          title: "Your onboarding playbook for social media retainers",
          slug: { current: "onboarding-playbook" },
          excerpt: "Streamline onboarding with standardized forms, readiness checks, and fulfillment handoffs.",
          publishedAt: "2024-01-05T00:00:00.000Z"
        },
        {
          title: "Automating campaign fulfillment with SMPLAT workflows",
          slug: { current: "automation-workflows" },
          excerpt: "Design task queues and notifications to keep growth campaigns moving without manual ping-pong.",
          publishedAt: "2024-01-12T00:00:00.000Z"
        }
      ])
    );

    const pricingSection = page?.content?.find((block) => block.layout === "pricing");
    expect(pricingSection?.pricingTiers).toHaveLength(2);

    const testimonialHighlight = page?.content?.find((block) => block._type === "testimonial");
    expect(testimonialHighlight).toMatchObject({
      quote: "SMPLAT keeps us shipping",
      author: "Jordan"
    });

    warnSpy.mockRestore();
  });

  it("fetches payload blog summaries", async () => {
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse(blogPostsFixture));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { getBlogPosts } = await import("../loaders");

    const posts = await getBlogPosts();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://payload.test/api/blog-posts?sort=-publishedAt&where%5Benvironment%5D%5Bequals%5D=test",
      expect.objectContaining({ method: "GET" })
    );

    expect(posts).toHaveLength(3);
    expect(posts).toEqual(
      expect.arrayContaining([
        {
          title: "Your onboarding playbook for social media retainers",
          slug: { current: "onboarding-playbook" },
          excerpt: "Streamline onboarding with standardized forms, readiness checks, and fulfillment handoffs.",
          publishedAt: "2024-01-05T00:00:00.000Z"
        },
        {
          title: "Automating campaign fulfillment with SMPLAT workflows",
          slug: { current: "automation-workflows" },
          excerpt: "Design task queues and notifications to keep growth campaigns moving without manual ping-pong.",
          publishedAt: "2024-01-12T00:00:00.000Z"
        }
      ])
    );

    warnSpy.mockRestore();
  });

  it("fetches payload blog detail with lexical body", async () => {
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse(blogPostDetailFixture));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = fetchMock as unknown as typeof fetch;

    const { getBlogPostBySlug } = await import("../loaders");

    const post = await getBlogPostBySlug("automation-workflows");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://payload.test/api/blog-posts?where%5Bslug%5D%5Bequals%5D=automation-workflows&where%5Benvironment%5D%5Bequals%5D=test&depth=2&limit=1",
      expect.objectContaining({ method: "GET" })
    );

    expect(post).toMatchObject({
      title: "Automating campaign fulfillment with SMPLAT workflows",
      slug: { current: "automation-workflows" },
      body: expect.objectContaining({
        root: expect.objectContaining({ type: "root" })
      })
    });

    warnSpy.mockRestore();
  });

  it("fetches draft payload pages when draft mode is enabled", async () => {
    draftState.isEnabled = true;
    const fetchMock = jest
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValue(createResponse(pageDraftFixture));

    global.fetch = fetchMock as unknown as typeof fetch;

    const { getPageBySlug } = await import("../loaders");

    const page = await getPageBySlug("draft-page", true);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("draft=true"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("depth=2"), expect.any(Object));

    expect(page).toMatchObject({
      _id: "draft-page-id",
      title: "Draft Launch Page",
      hero: {
        eyebrow: "Preview",
        headline: "Draft Ready",
        subheadline: "Pending publication",
        cta: { label: "Review", href: "#review" }
      }
    });

    const metricsSection = page?.content?.find((block) => block._type === "section" && block.layout === "metrics");
    expect(metricsSection?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Launch window", value: "2 weeks" }),
        expect.objectContaining({ label: "Readiness", value: "80%", description: "Pending QA" })
      ])
    );

    const blogSection = page?.content?.find((block) => block._type === "section" && block.layout === "blog");
    expect(blogSection?.blogPosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Preview onboarding checks",
          slug: { current: "preview-onboarding" },
          excerpt: "Ensure draft payloads resolve relationships.",
          publishedAt: "2024-02-10T00:00:00.000Z"
        }),
        expect.objectContaining({
          title: "Preview analytics",
          slug: { current: "preview-analytics" },
          excerpt: "Validate data sync before going live.",
          publishedAt: "2024-02-15T00:00:00.000Z"
        })
      ])
    );

    const testimonialBlock = page?.content?.find((block) => block._type === "testimonial");
    expect(testimonialBlock).toMatchObject({
      quote: "Draft previews keep us aligned.",
      author: "Morgan",
      role: "Product Lead"
    });
  });
});

describe.each([
  { label: "published", preview: false },
  { label: "draft", preview: true }
])("marketing preview snapshots (%s)", ({ preview }) => {
  it("serializes hero, metrics, and marketing blocks deterministically", async () => {
    const snapshots = await collectMarketingPreviewSnapshots({
      preview,
      fallbackLexicalState: lexicalMarketingFixture as unknown,
      loaders: {
        getHomepage: async () => (preview ? homepageVariants.draft : homepageVariants.published),
        getPageBySlug: async (slug: string) => {
          const entry = marketingPageMap[slug as keyof typeof marketingPageMap];
          if (!entry) {
            return null;
          }
          return preview ? entry.draft : entry.published;
        },
        getBlogPosts: async () => blogPosts
      }
    });

    expect(snapshots).toMatchSnapshot();
    expect(snapshots.some((snapshot) => (snapshot.metrics?.values.length ?? 0) > 0)).toBe(true);
    const blockKindSet = new Set(snapshots.flatMap((snapshot) => snapshot.blockKinds));
    expect(blockKindSet).toEqual(new Set(expectedBlockKinds));
  });
});

it("collects timeline payloads with route summaries", async () => {
  const timeline = await collectMarketingPreviewSnapshotTimeline({
    historyLimit: 2,
    fallbackLexicalState: lexicalMarketingFixture as unknown,
    loaders: {
      getHomepage: async () => homepageVariants.published,
      getPageBySlug: async (slug: string) => {
        const entry = marketingPageMap[slug as keyof typeof marketingPageMap];
        return entry?.published ?? null;
      },
      getBlogPosts: async () => blogPosts
    }
  });

  expect(timeline.current.routes.length).toBeGreaterThan(0);
  expect(timeline.current.snapshots.published.length).toBeGreaterThan(0);
  expect(timeline.history.length).toBeGreaterThanOrEqual(0);
});

const draftState = { isEnabled: false };

jest.mock("next/headers", () => ({
  draftMode: () => draftState
}));
