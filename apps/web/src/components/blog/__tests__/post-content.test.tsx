import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next-sanity", () => ({
  PortableText: ({ value }: { value: unknown }) => (
    <div data-testid="portable-text" data-value={JSON.stringify(value)} />
  )
}));

jest.mock("@payloadcms/richtext-lexical/html", () => ({
  convertLexicalToHTML: ({ data }: { data: any; disableContainer?: boolean }) => {
    const nodes: any[] = data?.root?.children ?? [];
    const toHTML = (items: any[]): string =>
      items
        .map((item) => {
          if (!item) {
            return "";
          }
          if (item.type === "text") {
            return item.text ?? "";
          }
          if (item.type === "link") {
            const href = item.fields?.url ?? "";
            return `<a href="${href}">${toHTML(item.children ?? [])}</a>`;
          }
          if (item.type === "paragraph") {
            return `<p>${toHTML(item.children ?? [])}</p>`;
          }
          if (item.type === "heading") {
            const tag = item.tag ?? "h2";
            return `<${tag}>${toHTML(item.children ?? [])}</${tag}>`;
          }
          if (item.type === "list") {
            const tag = item.tag ?? "ul";
            return `<${tag}>${toHTML(item.children ?? [])}</${tag}>`;
          }
          if (item.type === "listitem") {
            return `<li>${toHTML(item.children ?? [])}</li>`;
          }
          return "";
        })
        .join("");

    return toHTML(nodes);
  }
}));

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
  });
});
