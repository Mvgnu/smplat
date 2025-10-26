import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const defaultFallback = Object.freeze([{ label: "Default", value: "1" }]);

const marketingSectionsMock = jest.fn(
  ({
    sections,
    sectionContentClassName,
    metricFallback
  }: {
    sections?: unknown;
    sectionContentClassName: string;
    metricFallback?: unknown;
  }) => {
    return (
      <div data-testid="marketing-sections">
        <pre data-testid="sections-json">{JSON.stringify(sections)}</pre>
        <span data-testid="section-class">{sectionContentClassName}</span>
        <span data-testid="metric-fallback-size">{Array.isArray(metricFallback) ? metricFallback.length : 0}</span>
      </div>
    );
  }
);

jest.mock("@/components/marketing/sections", () => ({
  MarketingSections: marketingSectionsMock,
  defaultMarketingMetricsFallback: defaultFallback
}));

jest.mock("@/server/cms/loaders", () => ({
  getPageBySlug: jest.fn(),
  getBlogPosts: jest.fn()
}));

const loaders = require("@/server/cms/loaders") as jest.Mocked<
  typeof import("@/server/cms/loaders")
>;

const parseSectionsFromMock = () => {
  const call = marketingSectionsMock.mock.calls.at(-1);
  return call ? (call[0]?.sections as unknown) : undefined;
};

describe("Marketing route integration", () => {
  beforeEach(() => {
    marketingSectionsMock.mockClear();
    loaders.getPageBySlug.mockReset();
    loaders.getBlogPosts.mockReset();
  });

  it("renders the blog page with Lexical sections and injected blog posts", async () => {
    const page = {
      _id: "page-blog",
      title: "Blog & Resources",
      hero: {
        eyebrow: "Insights",
        headline: "Blog & Resources",
        subheadline: "Playbooks, automation templates, and growth tactics"
      },
      content: [
        {
          _type: "section" as const,
          _key: "blog",
          layout: "blog",
          content: undefined,
          marketingContent: undefined,
          metrics: undefined,
          faqItems: undefined,
          testimonials: undefined,
          caseStudy: undefined,
          pricingTiers: undefined,
          blogPosts: undefined,
          heading: undefined,
          subheading: undefined
        }
      ]
    };
    const posts = [
      {
        title: "Lexical scaling",
        slug: { current: "lexical-scaling" },
        excerpt: "Scale marketing content effortlessly",
        publishedAt: "2024-02-01T00:00:00.000Z"
      }
    ];

    loaders.getPageBySlug.mockResolvedValue(page as unknown as Awaited<ReturnType<typeof loaders.getPageBySlug>>);
    loaders.getBlogPosts.mockResolvedValue(posts as Awaited<ReturnType<typeof loaders.getBlogPosts>>);

    const { default: BlogPage } = await import("@/app/(marketing)/blog/page");
    const view = await BlogPage();
    render(view);

    expect(screen.getByText("Blog & Resources")).toBeInTheDocument();
    expect(loaders.getPageBySlug).toHaveBeenCalledWith("blog");
    expect(loaders.getBlogPosts).toHaveBeenCalled();

    const sections = parseSectionsFromMock();
    expect(Array.isArray(sections)).toBe(true);
    const firstSection = Array.isArray(sections) ? (sections as unknown[])[0] : undefined;
    expect(firstSection && typeof firstSection === "object" && "blogPosts" in (firstSection as Record<string, unknown>)).toBe(
      true
    );
    expect((firstSection as { blogPosts?: unknown }).blogPosts).toEqual(posts);
    expect(screen.getByTestId("section-class").textContent).toContain("max-w-3xl");
    expect(screen.getByTestId("metric-fallback-size").textContent).toBe(String(defaultFallback.length));
  });

  it("renders the pricing page using the Lexical renderer", async () => {
    const page = {
      _id: "page-pricing",
      title: "Pricing",
      hero: {
        eyebrow: "Plans",
        headline: "Pricing",
        subheadline: "Choose the bundle that fits"
      },
      content: [
        {
          _type: "section" as const,
          _key: "pricing",
          layout: "pricing",
          marketingContent: undefined,
          metrics: undefined,
          faqItems: undefined,
          testimonials: undefined,
          caseStudy: undefined,
          pricingTiers: [],
          blogPosts: undefined,
          heading: "Plans",
          subheading: undefined,
          content: undefined
        }
      ]
    };

    loaders.getPageBySlug.mockResolvedValue(page as unknown as Awaited<ReturnType<typeof loaders.getPageBySlug>>);

    const { default: PricingPage } = await import("@/app/(marketing)/pricing/page");
    const view = await PricingPage();
    render(view);

    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(loaders.getPageBySlug).toHaveBeenCalledWith("pricing");
    const sections = parseSectionsFromMock();
    expect(sections).toEqual(page.content);
  });

  it("renders the campaigns page using the Lexical renderer", async () => {
    const page = {
      _id: "page-campaigns",
      title: "Campaign Services",
      hero: {
        eyebrow: "Campaign Ops",
        headline: "Campaign Services",
        subheadline: "From launch to optimization"
      },
      content: [
        {
          _type: "section" as const,
          _key: "timeline",
          layout: "timeline",
          marketingContent: undefined,
          metrics: undefined,
          faqItems: undefined,
          testimonials: undefined,
          caseStudy: undefined,
          pricingTiers: undefined,
          blogPosts: undefined,
          heading: "Milestones",
          subheading: undefined,
          content: undefined
        }
      ]
    };

    loaders.getPageBySlug.mockResolvedValue(page as unknown as Awaited<ReturnType<typeof loaders.getPageBySlug>>);

    const { default: CampaignsPage } = await import("@/app/(marketing)/campaigns/page");
    const view = await CampaignsPage();
    render(view);

    expect(screen.getByText("Campaign Services")).toBeInTheDocument();
    expect(loaders.getPageBySlug).toHaveBeenCalledWith("campaigns");
    const sections = parseSectionsFromMock();
    expect(sections).toEqual(page.content);
  });
});
