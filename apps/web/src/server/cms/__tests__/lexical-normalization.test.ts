import { describe, expect, it } from "@jest/globals";

import { normalizeMarketingLexicalContent } from "../lexical";

type LexicalNode = {
  type?: string;
  children?: LexicalNode[];
  fields?: Record<string, unknown>;
};

const createState = (children: LexicalNode[]) => ({
  root: {
    type: "root",
    children
  }
});

describe("normalizeMarketingLexicalContent", () => {
  it("returns sanitized hero content", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-hero",
          headline: "Welcome",
          primaryCtaLabel: "Start",
          primaryCtaHref: "/start"
        }
      }
    ]);

    const result = normalizeMarketingLexicalContent(state, { sectionLabel: "hero" });
    expect(result.warnings).toHaveLength(0);
    expect(result.nodes).toEqual([
      expect.objectContaining({
        kind: "hero",
        headline: "Welcome",
        primaryCtaLabel: "Start",
        primaryCtaHref: "/start"
      })
    ]);
  });

  it("ignores unsupported blocks and reports warnings", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "custom-block"
        }
      }
    ]);

    const result = normalizeMarketingLexicalContent(state, { sectionLabel: "unsupported" });
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings.some((message) => message.includes("Unsupported marketing block type \"custom-block\""))).toBe(
      true
    );
  });

  it("hydrates testimonial relationship documents", () => {
    const state = createState([
      {
        type: "block",
        fields: {
          blockType: "marketing-testimonial",
          testimonial: {
            relationTo: "testimonials",
            value: {
              quote: "This platform is outstanding.",
              author: "Alex",
              role: "Founder"
            }
          }
        }
      }
    ]);

    const result = normalizeMarketingLexicalContent(state, { sectionLabel: "testimonial" });
    expect(result.warnings).toHaveLength(0);
    expect(result.nodes).toEqual([
      expect.objectContaining({
        kind: "testimonial",
        quote: "This platform is outstanding.",
        author: "Alex",
        role: "Founder"
      })
    ]);
  });

  it("warns when lexical state is invalid", () => {
    const result = normalizeMarketingLexicalContent(null, { sectionLabel: "invalid" });
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings.some((message) => message.includes("not a valid editor state"))).toBe(true);
  });
});
