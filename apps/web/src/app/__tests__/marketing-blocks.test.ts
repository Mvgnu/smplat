import { describe, expect, it } from "@jest/globals";

import { parseMarketingSectionContent } from "@/marketing/content";

const createState = (children: unknown[]) => ({
  root: {
    type: "root",
    children
  }
});

describe("parseMarketingSectionContent", () => {
  it("parses hero blocks", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-hero",
          blockName: "hero-1",
          eyebrow: "Test eyebrow",
          headline: "A headline",
          body: "A supporting body",
          primaryCtaLabel: "Start",
          primaryCtaHref: "/start",
          align: "start"
        }
      }
    ]);

    const result = parseMarketingSectionContent(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "hero",
      key: "hero-1",
      eyebrow: "Test eyebrow",
      headline: "A headline",
      body: "A supporting body",
      primaryCtaLabel: "Start",
      primaryCtaHref: "/start",
      align: "start"
    });
  });

  it("parses metric blocks and filters invalid metrics", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-metrics",
          heading: "Performance",
          metrics: [
            { label: "Clients", value: "120" },
            { label: "Invalid" }
          ]
        }
      }
    ]);

    const result = parseMarketingSectionContent(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "metrics",
      heading: "Performance"
    });
    expect(result[0].kind === "metrics" ? result[0].metrics : []).toEqual([
      { label: "Clients", value: "120", description: undefined }
    ]);
  });

  it("collects nested testimonial blocks", () => {
    const state = createState([
      {
        type: "paragraph",
        children: [
          {
            type: "block",
            fields: {
              blockType: "marketing-testimonial",
              quote: "This platform changed everything.",
              author: "Taylor"
            }
          }
        ]
      }
    ]);

    const result = parseMarketingSectionContent(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "testimonial",
      quote: "This platform changed everything.",
      author: "Taylor"
    });
  });

  it("parses product cards and filters empty features", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-product-card",
          name: "Growth plan",
          description: "All the essentials",
          price: 199,
          currency: "USD",
          features: [{ label: "24/7 support" }, { label: "" }],
          ctaLabel: "Choose plan",
          ctaHref: "/pricing"
        }
      }
    ]);

    const result = parseMarketingSectionContent(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "product",
      name: "Growth plan",
      price: 199,
      currency: "USD",
      ctaLabel: "Choose plan",
      ctaHref: "/pricing"
    });
    expect(result[0].kind === "product" ? result[0].features : []).toEqual([
      { id: undefined, label: "24/7 support" }
    ]);
  });

  it("ignores unsupported blocks and testimonials without quotes", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-testimonial",
          author: "Jordan"
        }
      },
      {
        type: "block",
        fields: {
          blockType: "custom-block"
        }
      }
    ]);

    const result = parseMarketingSectionContent(state);
    expect(result).toHaveLength(0);
  });
});
