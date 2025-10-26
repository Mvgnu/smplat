// meta: marketing-normalization: lexical-blocks

export const MARKETING_BLOCK_TYPES = new Set([
  "marketing-hero",
  "marketing-metrics",
  "marketing-testimonial",
  "marketing-product-card",
  "marketing-timeline",
  "marketing-feature-grid",
  "marketing-media-gallery",
  "marketing-cta-cluster",
  "marketing-comparison-table"
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

export type TimelineItem = {
  id?: string;
  title?: string;
  description?: string;
  timestamp?: string;
};

export type TimelineContent = {
  kind: "timeline";
  key?: string;
  heading?: string;
  subheading?: string;
  items: TimelineItem[];
};

export type FeatureItem = {
  id?: string;
  title?: string;
  description?: string;
  icon?: string;
};

export type FeatureGridContent = {
  kind: "feature-grid";
  key?: string;
  heading?: string;
  subheading?: string;
  features: FeatureItem[];
  columns?: number;
};

export type MediaItem = {
  id?: string;
  kind?: "image" | "video";
  src?: string;
  alt?: string;
  caption?: string;
  poster?: string;
};

export type MediaGalleryContent = {
  kind: "media-gallery";
  key?: string;
  heading?: string;
  subheading?: string;
  media: MediaItem[];
  columns?: number;
};

export type CtaItem = {
  id?: string;
  label?: string;
  href?: string;
  description?: string;
};

export type CtaClusterContent = {
  kind: "cta-cluster";
  key?: string;
  heading?: string;
  subheading?: string;
  align?: "start" | "center";
  ctas: CtaItem[];
};

export type ComparisonColumn = {
  id?: string;
  label?: string;
  highlight?: boolean;
  footnote?: string;
};

export type ComparisonRow = {
  id?: string;
  label?: string;
  values: Array<string | boolean | null>;
};

export type ComparisonTableContent = {
  kind: "comparison-table";
  key?: string;
  heading?: string;
  subheading?: string;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
};

export type MarketingContent =
  | HeroContent
  | MetricsContent
  | TestimonialContent
  | ProductContent
  | TimelineContent
  | FeatureGridContent
  | MediaGalleryContent
  | CtaClusterContent
  | ComparisonTableContent;

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

const toTimelineItems = (value: unknown): TimelineItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = toStringOrUndefined(record.title) ?? toStringOrUndefined(record.label);
      const description = toStringOrUndefined(record.description);
      const timestamp = toStringOrUndefined(record.timestamp) ?? toStringOrUndefined(record.date);

      if (!title && !description) {
        return null;
      }

      return {
        id: toStringOrUndefined(record.id),
        title,
        description,
        timestamp
      } satisfies TimelineItem;
    })
    .filter(Boolean) as TimelineItem[];
};

const toFeatureItems = (value: unknown): FeatureItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = toStringOrUndefined(record.title) ?? toStringOrUndefined(record.label);
      if (!title) {
        return null;
      }

      return {
        id: toStringOrUndefined(record.id),
        title,
        description: toStringOrUndefined(record.description),
        icon: toStringOrUndefined(record.icon)
      } satisfies FeatureItem;
    })
    .filter(Boolean) as FeatureItem[];
};

const toMediaItems = (value: unknown): MediaItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const src = toStringOrUndefined(record.src) ?? toStringOrUndefined(record.url);
      if (!src) {
        return null;
      }

      const kind = toStringOrUndefined(record.kind) ?? toStringOrUndefined(record.type);
      const normalizedKind = kind === "video" ? "video" : "image";

      return {
        id: toStringOrUndefined(record.id),
        kind: normalizedKind,
        src,
        alt: toStringOrUndefined(record.alt) ?? toStringOrUndefined(record.title),
        caption: toStringOrUndefined(record.caption),
        poster: toStringOrUndefined(record.poster)
      } satisfies MediaItem;
    })
    .filter(Boolean) as MediaItem[];
};

const toCtaItems = (value: unknown): CtaItem[] => {
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
      const href = toStringOrUndefined(record.href) ?? toStringOrUndefined(record.url);
      if (!label || !href) {
        return null;
      }

      return {
        id: toStringOrUndefined(record.id),
        label,
        href,
        description: toStringOrUndefined(record.description)
      } satisfies CtaItem;
    })
    .filter(Boolean) as CtaItem[];
};

const toComparisonColumns = (value: unknown): ComparisonColumn[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = toStringOrUndefined(record.label) ?? toStringOrUndefined(record.title);
      if (!label) {
        return null;
      }

      return {
        id: toStringOrUndefined(record.id),
        label,
        highlight: record.highlight === true,
        footnote: toStringOrUndefined(record.footnote)
      } satisfies ComparisonColumn;
    })
    .filter(Boolean) as ComparisonColumn[];
};

const toComparisonRows = (value: unknown): ComparisonRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = toStringOrUndefined(record.label) ?? toStringOrUndefined(record.title);
      if (!label) {
        return null;
      }

      const valuesSource = Array.isArray(record.values) ? record.values : [];
      const values = valuesSource.map((entry) => {
        if (typeof entry === "boolean") {
          return entry;
        }
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          const cell = entry as Record<string, unknown>;
          if (typeof cell.value === "boolean") {
            return cell.value;
          }
          if (typeof cell.value === "string") {
            return cell.value;
          }
        }
        return null;
      });

      return {
        id: toStringOrUndefined(record.id),
        label,
        values
      } satisfies ComparisonRow;
    })
    .filter(Boolean) as ComparisonRow[];
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

const createTimelineContent = (fields: Record<string, unknown>): TimelineContent | null => {
  const items = toTimelineItems(fields.items ?? fields.steps);

  if (items.length === 0) {
    return null;
  }

  return {
    kind: "timeline",
    key: toKeyOrUndefined(fields),
    heading: toStringOrUndefined(fields.heading),
    subheading: toStringOrUndefined(fields.subheading),
    items
  } satisfies TimelineContent;
};

const createFeatureGridContent = (fields: Record<string, unknown>): FeatureGridContent | null => {
  const features = toFeatureItems(fields.features);

  if (features.length === 0) {
    return null;
  }

  const columns = typeof fields.columns === "number" && fields.columns > 0 ? fields.columns : undefined;

  return {
    kind: "feature-grid",
    key: toKeyOrUndefined(fields),
    heading: toStringOrUndefined(fields.heading),
    subheading: toStringOrUndefined(fields.subheading),
    features,
    columns
  } satisfies FeatureGridContent;
};

const createMediaGalleryContent = (fields: Record<string, unknown>): MediaGalleryContent | null => {
  const media = toMediaItems(fields.media ?? fields.items);

  if (media.length === 0) {
    return null;
  }

  const columns = typeof fields.columns === "number" && fields.columns > 0 ? fields.columns : undefined;

  return {
    kind: "media-gallery",
    key: toKeyOrUndefined(fields),
    heading: toStringOrUndefined(fields.heading),
    subheading: toStringOrUndefined(fields.subheading),
    media,
    columns
  } satisfies MediaGalleryContent;
};

const createCtaClusterContent = (fields: Record<string, unknown>): CtaClusterContent | null => {
  const ctas = toCtaItems(fields.ctas ?? fields.items);

  if (ctas.length === 0) {
    return null;
  }

  const align = fields.align === "start" ? "start" : "center";

  return {
    kind: "cta-cluster",
    key: toKeyOrUndefined(fields),
    heading: toStringOrUndefined(fields.heading),
    subheading: toStringOrUndefined(fields.subheading),
    align,
    ctas
  } satisfies CtaClusterContent;
};

const createComparisonTableContent = (
  fields: Record<string, unknown>
): ComparisonTableContent | null => {
  const columns = toComparisonColumns(fields.columns);
  const rows = toComparisonRows(fields.rows);

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  return {
    kind: "comparison-table",
    key: toKeyOrUndefined(fields),
    heading: toStringOrUndefined(fields.heading),
    subheading: toStringOrUndefined(fields.subheading),
    columns,
    rows
  } satisfies ComparisonTableContent;
};

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
    case "marketing-timeline":
      return createTimelineContent(fields);
    case "marketing-feature-grid":
      return createFeatureGridContent(fields);
    case "marketing-media-gallery":
      return createMediaGalleryContent(fields);
    case "marketing-cta-cluster":
      return createCtaClusterContent(fields);
    case "marketing-comparison-table":
      return createComparisonTableContent(fields);
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
