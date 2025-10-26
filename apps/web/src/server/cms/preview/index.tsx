import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";


import { MarketingSections, defaultMarketingMetricsFallback, type MetricItem } from "@/components/marketing/sections";
import lexicalMarketingFixture from "../__fixtures__/payload-lexical-marketing.json" assert { type: "json" };
import { normalizeMarketingLexicalContent } from "../lexical";
import { getHomepage, getPageBySlug, getBlogPosts } from "../loaders";
import type { BlogPostSummary, MarketingContentDocument, PageDocument } from "../types";
import type { LexicalEditorState } from "@/marketing/content";

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = NodeTextEncoder as unknown as typeof globalThis.TextEncoder;
}

if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = NodeTextDecoder as unknown as typeof globalThis.TextDecoder;
}

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

const PREVIEW_SECTION_CLASSNAME =
  "mx-auto max-w-3xl space-y-4 text-left [&_*]:text-white/80 [&_strong]:text-white [&_a]:underline";

const DEFAULT_OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/marketing-preview-snapshots.json"
);

type MarketingPreviewRoute =
  | { route: string; kind: "homepage" }
  | { route: string; kind: "page"; slug: string }
  | { route: string; kind: "blog"; slug: string };

const PREVIEW_ROUTES: MarketingPreviewRoute[] = [
  { route: "/", kind: "homepage" },
  { route: "/pricing", kind: "page", slug: "pricing" },
  { route: "/campaigns", kind: "page", slug: "campaigns" },
  { route: "/blog", kind: "blog", slug: "blog" },
  { route: "/operations", kind: "page", slug: "operations" }
];

type MarketingPreviewLoaders = {
  getHomepage: (preview?: boolean) => Promise<PageDocument | null>;
  getPageBySlug: (slug: string, preview?: boolean) => Promise<PageDocument | null>;
  getBlogPosts: (preview?: boolean) => Promise<BlogPostSummary[]>;
};

type CollectPreviewOptions = {
  preview?: boolean;
  fallbackLexicalState?: LexicalEditorState;
  metricFallback?: MetricItem[];
  sectionContentClassName?: string;
  includeRoutes?: string[];
  loaders?: Partial<MarketingPreviewLoaders>;
};

type SnapshotMetrics = {
  label?: string;
  values: Array<{ label?: string; value?: string }>;
};

type MarketingPreviewSnapshot = {
  route: string;
  preview: boolean;
  hero?: PageDocument["hero"];
  title?: string;
  sectionCount: number;
  blockKinds: string[];
  metrics?: SnapshotMetrics;
  markup: string;
};

const defaultLoaders: MarketingPreviewLoaders = {
  getHomepage,
  getPageBySlug,
  getBlogPosts
};

const FALLBACK_HERO = {
  eyebrow: "Preview", // meta: preview-hero: fallback
  headline: "Deterministic marketing preview",
  subheadline: "Payload content unavailable – using fixture graph."
};

const ensureLexicalState = (state?: LexicalEditorState): LexicalEditorState => {
  const fallback = lexicalMarketingFixture as unknown;
  if (state && typeof state === "object") {
    return state;
  }
  return fallback as LexicalEditorState;
};

const createFixtureSection = (state: LexicalEditorState, label: string): NonNullable<PageDocument["content"]>[number] => {
  const { nodes } = normalizeMarketingLexicalContent(state, {
    sectionLabel: label,
    logger: () => {}
  });

  const marketingContent = nodes as MarketingContentDocument[];

  return {
    _type: "section",
    _key: `fixture-${label}`,
    heading: "Preview fixture",
    subheading: "Deterministic Lexical marketing block graph",
    layout: undefined,
    content: state,
    marketingContent,
    metrics: undefined,
    faqItems: undefined,
    testimonials: undefined,
    caseStudy: undefined,
    pricingTiers: undefined,
    blogPosts: undefined
  };
};

const ensureSections = (page: PageDocument | null | undefined, state: LexicalEditorState) => {
  if (page?.content && page.content.length > 0) {
    return page.content;
  }

  return [createFixtureSection(state, page?.title ?? "marketing-preview")];
};

const ensureHero = (page: PageDocument | null | undefined) => {
  if (page?.hero) {
    return page.hero;
  }
  return { ...FALLBACK_HERO, headline: page?.title ?? FALLBACK_HERO.headline };
};

const collectBlockKinds = (sections: PageDocument["content"]): string[] => {
  if (!sections?.length) {
    return [];
  }

  const kinds = new Set<string>();
  for (const section of sections) {
    if (section._type !== "section") continue;
    if (Array.isArray(section.marketingContent)) {
      for (const block of section.marketingContent) {
        if (block?.kind) {
          kinds.add(block.kind);
        }
      }
    }
  }
  return Array.from(kinds).sort();
};

const resolveMetricsSummary = (sections: PageDocument["content"]): SnapshotMetrics | undefined => {
  if (!sections?.length) {
    return undefined;
  }

  for (const section of sections) {
    if (section._type !== "section") continue;
    if (!Array.isArray(section.marketingContent)) {
      continue;
    }
    for (const block of section.marketingContent) {
      if (block?.kind === "metrics") {
        const values = Array.isArray(block.metrics)
          ? block.metrics.map((item) => ({ label: item?.label, value: item?.value }))
          : [];
        return {
          label: block.heading ?? block.subheading,
          values
        };
      }
    }
  }
  return undefined;
};

const mergeBlogPostsIntoSections = (
  sections: PageDocument["content"],
  posts: BlogPostSummary[]
): PageDocument["content"] => {
  if (!sections?.length || !posts.length) {
    return sections;
  }

  return sections.map((section) => {
    if (section._type !== "section") {
      return section;
    }

    const hasBlogLayout = section.layout === "blog";
    const hasExistingPosts = Array.isArray(section.blogPosts) && section.blogPosts.length > 0;

    if (!hasBlogLayout || hasExistingPosts) {
      return section;
    }

    return {
      ...section,
      blogPosts: posts
    };
  });
};

const renderMarkup = (
  sections: PageDocument["content"],
  metricFallback: MetricItem[],
  sectionContentClassName: string,
  id?: string
) => {
  if (!sections?.length) {
    return "";
  }

  const markup = renderToStaticMarkup(
    <MarketingSections
      id={id}
      sections={sections}
      sectionContentClassName={sectionContentClassName}
      metricFallback={metricFallback}
    />
  );

  return markup;
};

export const collectMarketingPreviewSnapshots = async (
  options: CollectPreviewOptions = {}
): Promise<MarketingPreviewSnapshot[]> => {
  const {
    preview = false,
    fallbackLexicalState,
    metricFallback = defaultMarketingMetricsFallback,
    sectionContentClassName = PREVIEW_SECTION_CLASSNAME,
    includeRoutes,
    loaders: loaderOverrides
  } = options;

  const state = ensureLexicalState(fallbackLexicalState);
  const loaders: MarketingPreviewLoaders = {
    ...defaultLoaders,
    ...loaderOverrides
  } as MarketingPreviewLoaders;

  const selectedRoutes = includeRoutes?.length
    ? PREVIEW_ROUTES.filter((route) => includeRoutes.includes(route.route))
    : PREVIEW_ROUTES;

  const snapshots: MarketingPreviewSnapshot[] = [];

  for (const descriptor of selectedRoutes) {
    if (descriptor.kind === "homepage") {
      const page = await loaders.getHomepage(preview);
      const sections = ensureSections(page, state);
      const markup = renderMarkup(sections, metricFallback, sectionContentClassName, "capabilities");
      snapshots.push({
        route: descriptor.route,
        preview,
        hero: ensureHero(page),
        title: page?.title,
        sectionCount: sections.length,
        blockKinds: collectBlockKinds(sections),
        metrics: resolveMetricsSummary(sections),
        markup
      });
      continue;
    }

    if (descriptor.kind === "blog") {
      const page = await loaders.getPageBySlug(descriptor.slug, preview);
      const hero = ensureHero(page);
      const sections = mergeBlogPostsIntoSections(ensureSections(page, state), await loaders.getBlogPosts(preview));
      const markup = renderMarkup(sections, metricFallback, sectionContentClassName);
      snapshots.push({
        route: descriptor.route,
        preview,
        hero,
        title: page?.title,
        sectionCount: sections.length,
        blockKinds: collectBlockKinds(sections),
        metrics: resolveMetricsSummary(sections),
        markup
      });
      continue;
    }

    const page = await loaders.getPageBySlug(descriptor.slug, preview);
    const hero = ensureHero(page);
    const sections = ensureSections(page, state);
    const markup = renderMarkup(sections, metricFallback, sectionContentClassName);
    snapshots.push({
      route: descriptor.route,
      preview,
      hero,
      title: page?.title,
      sectionCount: sections.length,
      blockKinds: collectBlockKinds(sections),
      metrics: resolveMetricsSummary(sections),
      markup
    });
  }

  return snapshots;
};

type WriteSnapshotsOptions = {
  outFile?: string;
  previewStates?: boolean[];
  collectOptions?: Omit<CollectPreviewOptions, "preview">;
};

export const writeMarketingPreviewSnapshots = async (options: WriteSnapshotsOptions = {}) => {
  const {
    outFile = DEFAULT_OUTPUT_PATH,
    previewStates = [false, true],
    collectOptions = {}
  } = options;

  const results: MarketingPreviewSnapshot[] = [];
  for (const preview of previewStates) {
    const snapshots = await collectMarketingPreviewSnapshots({ ...collectOptions, preview });
    results.push(...snapshots);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    snapshots: results
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return payload;
};

export type { MarketingPreviewSnapshot };
