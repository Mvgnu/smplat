export const MARKETING_BLOCK_TYPES = new Set([
  "marketing-hero",
  "marketing-metrics",
  "marketing-testimonial",
  "marketing-product-card"
]);

export type HeroContent = {
  kind: "hero";
  key?: string;
  eyebrow?: string;
  headline?: string;
  body?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  align?: "start" | "center";
};

export type MetricsContent = {
  kind: "metrics";
  key?: string;
  heading?: string;
  subheading?: string;
  metrics: MetricItem[];
};

export type MetricItem = {
  label?: string;
  value?: string;
  description?: string;
};

export type TestimonialContent = {
  kind: "testimonial";
  key?: string;
  quote: string;
  author?: string;
  role?: string;
  company?: string;
};

export type ProductContent = {
  kind: "product";
  key?: string;
  badge?: string;
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  frequency?: string;
  features: ProductFeature[];
  ctaLabel?: string;
  ctaHref?: string;
};

export type ProductFeature = {
  id?: string;
  label?: string;
};

export type MarketingContent =
  | HeroContent
  | MetricsContent
  | TestimonialContent
  | ProductContent;

type LexicalNode = {
  type?: unknown;
  children?: unknown;
  fields?: unknown;
};

export type LexicalEditorState = {
  root?: {
    type?: unknown;
    children?: unknown;
  };
};

export const toStringOrUndefined = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

export const toNumberOrUndefined = (value: unknown) => (typeof value === "number" ? value : undefined);

export const toKeyOrUndefined = (fields: Record<string, unknown>) =>
  toStringOrUndefined(fields.id) ?? toStringOrUndefined(fields.blockName);

const toMetricItems = (value: unknown): MetricItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = toStringOrUndefined(record.label);
      const metricValue = toStringOrUndefined(record.value);
      if (!label || !metricValue) {
        return null;
      }

      return {
        label,
        value: metricValue,
        description: toStringOrUndefined(record.description)
      } satisfies MetricItem;
    })
    .filter(Boolean) as MetricItem[];
};

const toProductFeatures = (value: unknown): ProductFeature[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = toStringOrUndefined(record.label);
      if (!label) {
        return null;
      }

      return {
        id: toStringOrUndefined(record.id),
        label
      } satisfies ProductFeature;
    })
    .filter(Boolean) as ProductFeature[];
};

const createHeroContent = (fields: Record<string, unknown>): HeroContent => ({
  kind: "hero",
  key: toKeyOrUndefined(fields),
  eyebrow: toStringOrUndefined(fields.eyebrow),
  headline: toStringOrUndefined(fields.headline),
  body: toStringOrUndefined(fields.body),
  primaryCtaLabel: toStringOrUndefined(fields.primaryCtaLabel),
  primaryCtaHref: toStringOrUndefined(fields.primaryCtaHref),
  secondaryCtaLabel: toStringOrUndefined(fields.secondaryCtaLabel),
  secondaryCtaHref: toStringOrUndefined(fields.secondaryCtaHref),
  align: fields.align === "start" ? "start" : "center"
});

const createMetricsContent = (fields: Record<string, unknown>): MetricsContent => ({
  kind: "metrics",
  key: toKeyOrUndefined(fields),
  heading: toStringOrUndefined(fields.heading),
  subheading: toStringOrUndefined(fields.subheading),
  metrics: toMetricItems(fields.metrics)
});

const createTestimonialContent = (fields: Record<string, unknown>): TestimonialContent | null => {
  const quote = toStringOrUndefined(fields.quote);
  if (!quote) {
    return null;
  }

  return {
    kind: "testimonial",
    key: toKeyOrUndefined(fields),
    quote,
    author: toStringOrUndefined(fields.author),
    role: toStringOrUndefined(fields.role),
    company: toStringOrUndefined(fields.company)
  };
};

const createProductContent = (fields: Record<string, unknown>): ProductContent => ({
  kind: "product",
  key: toKeyOrUndefined(fields),
  badge: toStringOrUndefined(fields.badge),
  name: toStringOrUndefined(fields.name),
  description: toStringOrUndefined(fields.description),
  price: toNumberOrUndefined(fields.price),
  currency: toStringOrUndefined(fields.currency),
  frequency: toStringOrUndefined(fields.frequency),
  features: toProductFeatures(fields.features),
  ctaLabel: toStringOrUndefined(fields.ctaLabel),
  ctaHref: toStringOrUndefined(fields.ctaHref)
});

export const isLexicalEditorState = (value: unknown): value is LexicalEditorState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const root = (value as LexicalEditorState).root;
  if (!root || typeof root !== "object") {
    return false;
  }

  if ((root as { type?: unknown }).type !== "root") {
    return false;
  }

  const children = (root as { children?: unknown }).children;
  return Array.isArray(children);
};

const collectMarketingNodes = (state: LexicalEditorState): Array<{
  blockType: string;
  fields: Record<string, unknown>;
}> => {
  const results: Array<{ blockType: string; fields: Record<string, unknown> }> = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const lexicalNode = node as LexicalNode;
    if (lexicalNode.type === "block" && lexicalNode.fields && typeof lexicalNode.fields === "object") {
      const fields = lexicalNode.fields as Record<string, unknown>;
      const blockType = toStringOrUndefined(fields.blockType);
      if (blockType && MARKETING_BLOCK_TYPES.has(blockType)) {
        results.push({ blockType, fields });
      }
    }

    if (Array.isArray(lexicalNode.children)) {
      lexicalNode.children.forEach(visit);
    }
  };

  const rootChildren = state.root?.children;
  if (Array.isArray(rootChildren)) {
    rootChildren.forEach(visit);
  }

  return results;
};

export const createMarketingContentFromBlock = (
  blockType: string,
  fields: Record<string, unknown>
): MarketingContent | null => {
  switch (blockType) {
    case "marketing-hero":
      return createHeroContent(fields);
    case "marketing-metrics":
      return createMetricsContent(fields);
    case "marketing-testimonial":
      return createTestimonialContent(fields);
    case "marketing-product-card":
      return createProductContent(fields);
    default:
      return null;
  }
};

export const parseMarketingSectionContent = (value: unknown): MarketingContent[] => {
  if (!isLexicalEditorState(value)) {
    return [];
  }

  return collectMarketingNodes(value)
    .map(({ blockType, fields }) => createMarketingContentFromBlock(blockType, fields))
    .filter(Boolean) as MarketingContent[];
};
