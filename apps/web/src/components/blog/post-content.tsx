import { PortableText, type PortableTextComponents } from "next-sanity";
import { convertLexicalToHTML } from "@payloadcms/richtext-lexical/html";

const components: PortableTextComponents = {
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

type PostContentProps = {
  value?: unknown;
};

export function PostContent({ value }: PostContentProps) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return null;
    }
    return <PortableText value={value} components={components} />;
  }

  if (typeof value === "object") {
    try {
      const html = convertLexicalToHTML({ data: value, disableContainer: true });
      if (!html) {
        return null;
      }
      return (
        <div
          className="space-y-4 [&_*]:text-white [&_a]:underline [&_h2]:text-3xl [&_h3]:text-2xl [&_p]:text-white/80"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } catch (error) {
      console.warn("Failed to render Payload rich text", error);
      return null;
    }
  }

  return null;
}
