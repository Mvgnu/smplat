import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next-sanity", () => ({
  PortableText: ({ value }: { value: unknown }) => (
    <div data-testid="portable-text" data-value={JSON.stringify(value)} />
  )
}));

jest.mock("@payloadcms/richtext-lexical/react", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  const renderNodes = (nodes: any[]): React.ReactNode[] =>
    (nodes ?? [])
      .map((node: any, index: number) => {
        if (!node) {
          return null;
        }

        if (node.type === "text") {
          return node.text ?? "";
        }

        if (node.type === "link") {
          const href = node.fields?.url ?? "";
          const children = renderNodes(node.children ?? []);
          return React.createElement(
            "a",
            {
              key: index,
              href,
              rel: node.fields?.newTab ? "noopener noreferrer" : undefined,
              target: node.fields?.newTab ? "_blank" : undefined
            },
            ...children
          );
        }

        if (node.type === "paragraph") {
          return React.createElement("p", { key: index }, ...renderNodes(node.children ?? []));
        }

        if (node.type === "heading") {
          const Tag = (node.tag ?? "h2") as keyof JSX.IntrinsicElements;
          return React.createElement(Tag, { key: index }, ...renderNodes(node.children ?? []));
        }

        if (node.type === "list") {
          const Tag = (node.tag ?? "ul") as keyof JSX.IntrinsicElements;
          return React.createElement(Tag, { key: index }, ...renderNodes(node.children ?? []));
        }

        if (node.type === "listitem") {
          return React.createElement("li", { key: index }, ...renderNodes(node.children ?? []));
        }

        return null;
      })
      .filter((node: React.ReactNode | null): node is React.ReactNode => node !== null);

  const MockRichText: React.FC<{ data: any; className?: string }> = ({ data, className }) => {
    const children = renderNodes(data?.root?.children ?? []);

    if (!children.length) {
      return null;
    }

    return React.createElement("div", { className }, ...children);
  };

  return {
    RichText: MockRichText
  };
});

import { payloadLexicalRichText } from "../__fixtures__/payload-lexical";

let PostContent!: (typeof import("../post-content"))["PostContent"];

beforeAll(async () => {
  ({ PostContent } = await import("../post-content"));
});

describe("PostContent", () => {
  it("renders Payload Lexical content with headings, lists, and links", () => {
    const { container } = render(<PostContent value={payloadLexicalRichText} />);

    expect(screen.getByRole("heading", { level: 2, name: "Lexical heading" })).toBeInTheDocument();

    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("First bullet");
    expect(listItems[1]).toHaveTextContent("Second bullet");

    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://example.com");

    expect(container.querySelector(".space-y-4")).not.toBeNull();
  });

  it("renders nothing for unsupported values", () => {
    const { container, rerender } = render(<PostContent value={null} />);
    expect(container.firstChild).toBeNull();

    rerender(<PostContent value={[]} />);
    expect(container.firstChild).toBeNull();

    rerender(
      <PostContent
        value={{
          root: {
            type: "root",
            children: []
          }
        }}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
