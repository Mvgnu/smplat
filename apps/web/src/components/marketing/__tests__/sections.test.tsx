import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

import type { PageSection } from "../sections";

jest.mock("@/components/rich-text/rich-text", () => ({
  RichText: ({ children }: { children?: React.ReactNode }) => <div data-testid="rich-text">{children}</div>
}));

const { MarketingSections } = require("../sections") as typeof import("../sections");

describe("MarketingSections", () => {
  it("renders normalized marketing content blocks", () => {
    const sections: PageSection[] = [
      {
        _type: "section",
        _key: "intro",
        marketingContent: [
          { kind: "hero", headline: "Automate growth", eyebrow: "Launch faster" },
          { kind: "metrics", heading: "Impact", subheading: "Proof points", metrics: [] },
          { kind: "testimonial", quote: "This platform scales with us", author: "River" },
          {
            kind: "product",
            name: "Retainer plan",
            description: "Done-for-you automation",
            features: [],
            price: 499,
            currency: "USD",
            frequency: "mo"
          }
        ],
        content: undefined,
        layout: undefined,
        metrics: undefined,
        faqItems: undefined,
        testimonials: undefined,
        caseStudy: undefined,
        pricingTiers: undefined,
        blogPosts: undefined,
        heading: undefined,
        subheading: undefined
      }
    ];

    render(
      <MarketingSections
        sections={sections}
        sectionContentClassName="lexical"
        metricFallback={[{ label: "Fallback", value: "100%" }]}
      />
    );

    expect(screen.getByText("Automate growth")).toBeInTheDocument();
    expect(screen.getByText("Fallback")).toBeInTheDocument();
    expect(screen.getByText("“This platform scales with us”")).toBeInTheDocument();
    expect(screen.getByText("Retainer plan")).toBeInTheDocument();
  });

  it("renders legacy layouts when marketing content is absent", () => {
    const sections: PageSection[] = [
      {
        _type: "section",
        _key: "faq",
        heading: "Answers",
        subheading: "Common questions",
        layout: "faq",
        content: undefined,
        marketingContent: undefined,
        faqItems: [
          { question: "How long is onboarding?", answer: "2 weeks" }
        ],
        metrics: undefined,
        testimonials: undefined,
        caseStudy: undefined,
        pricingTiers: undefined,
        blogPosts: undefined
      }
    ];

    render(
      <MarketingSections sections={sections} sectionContentClassName="lexical" />
    );

    expect(screen.getByText("Answers")).toBeInTheDocument();
    expect(screen.getByText("How long is onboarding?")).toBeInTheDocument();
  });
});
