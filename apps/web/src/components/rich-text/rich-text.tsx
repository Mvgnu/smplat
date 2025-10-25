import { PortableText, type PortableTextComponents } from "next-sanity";
import {
  RichText as PayloadLexicalRichText,
  type JSXConverters,
  type JSXConvertersFunction
} from "@payloadcms/richtext-lexical/react";
import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

const defaultPortableTextComponents: PortableTextComponents = {
  types: {
    image: ({ value }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value?.asset?.url ?? ""} alt={value?.alt ?? ""} className="my-6 w-full rounded-3xl border border-white/10" />
    )
  },
  block: {
    h2: ({ children }) => <h2 className="mt-10 text-3xl font-semibold text-white">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-8 text-2xl font-semibold text-white">{children}</h3>,
    normal: ({ children }) => <p className="mt-4 text-white/80">{children}</p>
  },
  marks: {
    strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
    em: ({ children }) => <em className="text-white/80">{children}</em>
  }
};

const defaultLexicalClassName =
  "space-y-4 [&_*]:text-white [&_a]:underline [&_h2]:text-3xl [&_h3]:text-2xl [&_p]:text-white/80";

type LexicalEditorState = SerializedEditorState<SerializedLexicalNode>;

type RichTextProps = {
  value?: unknown;
  components?: PortableTextComponents;
  lexicalClassName?: string;
  lexicalConverters?: JSXConverters | JSXConvertersFunction;
};

const isLexicalEditorState = (value: unknown): value is LexicalEditorState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const root = (value as { root?: unknown }).root;

  if (!root || typeof root !== "object") {
    return false;
  }

  const { type, children } = root as { type?: unknown; children?: unknown };

  return type === "root" && Array.isArray(children);
};

const hasLexicalContent = (state: LexicalEditorState) => state.root.children.length > 0;

export function RichText({
  value,
  components = defaultPortableTextComponents,
  lexicalClassName = defaultLexicalClassName,
  lexicalConverters
}: RichTextProps) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }

    return <PortableText value={value} components={components} />;
  }

  if (isLexicalEditorState(value)) {
    if (!hasLexicalContent(value)) {
      return null;
    }

    return (
      <PayloadLexicalRichText
        className={lexicalClassName}
        converters={lexicalConverters}
        data={value}
      />
    );
  }

  if (typeof value === "object") {
    console.warn("RichText received an unsupported value", value);
  }

  return null;
}
