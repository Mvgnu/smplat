import { describe, expect, it } from "@jest/globals";

import { resolveStorefrontExperience, storefrontExperience, getStorefrontProductExperience } from "../storefront-experience";
import type { PageDocument } from "@/server/cms/types";

const basePage: PageDocument = {
  _id: "homepage",
  title: "Homepage",
  hero: {
    eyebrow: "Original",
    headline: "Original headline",
    subheadline: "Original subheadline",
    cta: {
      label: "Origin",
      href: "#origin"
    }
  },
  content: []
};

const buildPage = (overrides: Partial<PageDocument>): PageDocument => ({
  ...basePage,
  ...overrides,
  hero: {
    ...basePage.hero,
    ...overrides.hero
  },
  content: overrides.content ?? basePage.content
});

describe("resolveStorefrontExperience", () => {
  it("overrides hero content when page data exists", () => {
    const page = buildPage({
      hero: {
        eyebrow: "CMS Eyebrow",
        headline: "CMS Headline",
        subheadline: "CMS Subheadline",
        cta: { label: "CTA", href: "/cta" }
      }
    });

    const experience = resolveStorefrontExperience(page);

    expect(experience.hero.headline).toBe("CMS Headline");
    expect(experience.hero.primaryCta.href).toBe("/cta");
    expect(experience.hero.primaryCta.label).toBe("CTA");
  });

  it("merges trust metrics with CMS overrides", () => {
    const page = buildPage({
      content: [
        {
          _type: "section",
          _key: "metrics",
          layout: "metrics",
          heading: "Trust",
          metrics: [
            { label: "Clearance window", value: "2.4 days", description: "Override metric" },
            { label: "Confidence", value: "95%", description: "Confidence override" }
          ]
        }
      ]
    });

    const experience = resolveStorefrontExperience(page);
    expect(experience.trustMetrics[0].label).toBe("Clearance window");
    expect(experience.trustMetrics[0].value).toBe("2.4 days");
    expect(experience.trustMetrics[0].trendLabel).toBe(storefrontExperience.trustMetrics[0].trendLabel);
    expect(experience.trustMetrics[1].label).toBe("Confidence");
  });

  it("hydrates product cards from marketing product blocks", () => {
    const page = buildPage({
      content: [
        {
          _type: "section",
          _key: "products",
          layout: "two-column",
          marketingContent: [
            {
              kind: "product",
              key: "cms-product",
              name: "CMS Commerce Kit",
              description: "CMS defined summary",
              price: 5200,
              currency: "USD",
              frequency: "per drop",
              features: [{ id: "cms", label: "CMS highlight" }],
              ctaLabel: "Book CMS Kit",
              ctaHref: "/products/cms-kit",
              badge: "New"
            }
          ]
        }
      ]
    });

    const experience = resolveStorefrontExperience(page);
    const product = experience.products[0];

    expect(product.name).toBe("CMS Commerce Kit");
    expect(product.summary).toBe("CMS defined summary");
    expect(product.price).toBe("$5,200");
    expect(product.highlights[0].label).toBe("CMS highlight");
    expect(product.ctaHref).toBe("/products/cms-kit");
  });

  it("maps testimonial entries while retaining fallback metrics", () => {
    const page = buildPage({
      content: [
        {
          _type: "testimonial",
          _key: "testimonial",
          quote: "CMS testimonial",
          author: "CMS Author",
          role: "CMS Role"
        }
      ]
    });

    const experience = resolveStorefrontExperience(page);
    expect(experience.testimonials[0].quote).toBe("CMS testimonial");
    expect(experience.testimonials[0].metric).toBe(storefrontExperience.testimonials[0].metric);
  });

  it("retrieves storefront product experience by slug with loyalty estimates", () => {
    const experience = getStorefrontProductExperience("instagram-growth");
    expect(experience).toBeDefined();
    expect(experience?.loyaltyHint.pointsEstimate).toBeGreaterThan(0);
  });
});
