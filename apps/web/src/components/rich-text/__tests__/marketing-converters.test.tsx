import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

jest.mock("next-sanity", () => ({
  PortableText: ({ value }: { value: unknown }) => (
    <div data-testid="portable-text" data-value={JSON.stringify(value)} />
  )
}));

jest.mock("@payloadcms/richtext-lexical/react", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  type Node = {
    type: string;
    fields?: any;
    children?: Node[];
    [key: string]: unknown;
  };

  const state: { lastConverters: any } = { lastConverters: null };

  const renderNodes = (nodes: Node[] = [], converters: any): React.ReactNode[] => {
    return nodes
      .map((node, index) => {
        if (!node) {
          return null;
        }

        if (node.type === "block") {
          const blockType = node.fields?.blockType;
          const converter = converters?.blocks?.[blockType];
          if (!converter) {
            return null;
          }

          if (typeof converter === "function") {
            return converter({
              childIndex: index,
              converters,
              node,
              nodesToJSX: ({ nodes: nested }: { nodes: Node[] }) => renderNodes(nested, converters),
              parent: node
            });
          }

          return converter;
        }

        if (node.type === "paragraph") {
          const paragraphChildren = renderNodes(node.children ?? [], converters);
          return React.createElement("p", { key: index }, ...paragraphChildren);
        }

        if (node.type === "text") {
          return node.text ?? "";
        }

        return null;
      })
      .filter((child): child is React.ReactNode => child !== null);
  };

  const defaultConverters = { blocks: {}, inlineBlocks: {} };

  const MockRichText: React.FC<{ data: any; className?: string; converters?: any }> = ({
    data,
    className,
    converters
  }) => {
    const resolvedConverters =
      typeof converters === "function"
        ? converters({ defaultConverters })
        : converters ?? defaultConverters;

    state.lastConverters = resolvedConverters;

    const children = renderNodes(data?.root?.children ?? [], resolvedConverters);
    if (!children.length) {
      return null;
    }

    return React.createElement("div", { className }, ...children);
  };

  return {
    RichText: MockRichText,
    __getLastConverters: () => state.lastConverters
  };
});

const getLexicalModule = () =>
  jest.requireMock("@payloadcms/richtext-lexical/react") as {
    __getLastConverters: () => any;
  };

type BlockFields = {
  blockType: string;
  blockName?: string;
  [key: string]: unknown;
};

type LexicalNode = {
  type: string;
  version: number;
  format: string;
  indent: number;
  direction: string;
  children: LexicalNode[];
  fields?: BlockFields;
};

const createBlockNode = (fields: BlockFields): LexicalNode => ({
  type: "block",
  version: 1,
  format: "",
  indent: 0,
  direction: "ltr",
  children: [],
  fields: {
    id: `${fields.blockType}-${Math.random().toString(16).slice(2)}`,
    blockName: fields.blockName,
    ...fields
  }
});

const createEditorState = (children: LexicalNode[]) => ({
  root: {
    type: "root",
    version: 1,
    format: "",
    indent: 0,
    direction: "ltr",
    children
  }
});

describe("RichText marketing converters", () => {
  it("renders hero, metrics, testimonial, and product blocks", async () => {
    const state = createEditorState([
      createBlockNode({
        blockType: "marketing-hero",
        eyebrow: "Agency growth",
        headline: "Launch marketing automation",
        body: "Scale fulfilment with prebuilt playbooks.",
        primaryCtaLabel: "Book demo",
        primaryCtaHref: "/demo",
        secondaryCtaLabel: "View pricing",
        secondaryCtaHref: "/pricing"
      }),
      createBlockNode({
        blockType: "marketing-metrics",
        heading: "Proof of impact",
        subheading: "Automation that keeps your pipeline engaged.",
        metrics: [
          { id: "m1", label: "Campaigns", value: "1,200+", description: "Launched this year" },
          { id: "m2", label: "Response rate", value: "67%" },
          { id: "m3", label: "Activation", value: "92%" }
        ]
      }),
      createBlockNode({
        blockType: "marketing-testimonial",
        quote: "SMPLAT helped us double lifetime value in a quarter.",
        author: "Morgan Lee",
        role: "Founder",
        company: "BrightWave"
      }),
      createBlockNode({
        blockType: "marketing-product-card",
        badge: "Most popular",
        name: "Managed Campaign Ops",
        description: "Hands-on operations with SLA-backed fulfilment.",
        price: 2400,
        currency: "USD",
        frequency: "month",
        features: [
          { id: "f1", label: "Campaign launch squad" },
          { id: "f2", label: "Compliance reviews" }
        ],
        ctaLabel: "Start onboarding",
        ctaHref: "/checkout"
      })
    ]);

    const { RichText } = await import("../rich-text");

    render(<RichText value={state} />);

    expect(screen.getByRole("heading", { name: "Launch marketing automation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book demo" })).toHaveAttribute("href", "/demo");
    expect(screen.getByText("Proof of impact")).toBeInTheDocument();
    expect(screen.getByText(/double lifetime value/i)).toBeInTheDocument();
    expect(screen.getByText("Managed Campaign Ops")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start onboarding" })).toHaveAttribute("href", "/checkout");
  });

  it("merges custom converters with marketing defaults", async () => {
    const { RichText } = await import("../rich-text");
    const lexicalModule = getLexicalModule();

    const state = createEditorState([
      createBlockNode({
        blockType: "marketing-hero",
        headline: "Default hero"
      })
    ]);

    render(
      <RichText
        value={state}
        lexicalConverters={{
          blocks: {
            "marketing-hero": () => <div data-testid="custom-hero">Custom hero override</div>
          }
        }}
      />
    );

    expect(screen.getByTestId("custom-hero")).toHaveTextContent("Custom hero override");
    const converters = lexicalModule.__getLastConverters();
    expect(converters.blocks["marketing-testimonial"]).toBeDefined();
    expect(converters.blocks["marketing-product-card"]).toBeDefined();
  });
});
