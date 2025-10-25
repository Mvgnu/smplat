import { cache } from "react";

import { getClient, isPayload, payloadGet } from "./client";
import { payloadConfig } from "./config";
import { normalizeMarketingLexicalContent } from "./lexical";
import { blogPostBySlugQuery, blogPostsQuery, homepageQuery, pageBySlugQuery } from "./queries";
import {
  blogPostDetailSchema,
  blogPostListSchema,
  pageSchema,
  type BlogPostSummary,
  type CaseStudyDocument,
  type PageDocument,
  type PricingTierDocument,
  type TestimonialDocument
} from "./types";

type PageSectionDocument = Extract<NonNullable<PageDocument["content"]>[number], { _type: "section" }>;

const withCache = <Fn extends (...args: never[]) => Promise<unknown>>(fn: Fn): Fn => {
  if (typeof cache === "function") {
    return cache(fn) as Fn;
  }
  return fn;
};

const parsePage = (data: unknown): PageDocument | null => {
  if (!data) {
    return null;
  }

  const result = pageSchema.safeParse(data);
  if (!result.success) {
    console.warn("Failed to parse page document", result.error.flatten());
    return null;
  }

  return result.data;
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  return typeof value === "number" ? value : undefined;
};

const toBooleanOrUndefined = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const toSlugObject = (value: unknown): { current?: string } | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return { current: value };
  }
  if (value && typeof value === "object" && "current" in value) {
    const slugValue = (value as { current?: unknown }).current;
    return typeof slugValue === "string" ? { current: slugValue } : undefined;
  }
  return undefined;
};

const normalizeTestimonials = (items: unknown): TestimonialDocument[] | undefined => {
  if (!Array.isArray(items)) return undefined;
  const result: TestimonialDocument[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const testimonial = {
      quote: toStringOrUndefined((item as Record<string, unknown>).quote) ?? "",
      author: toStringOrUndefined((item as Record<string, unknown>).author),
      role: toStringOrUndefined((item as Record<string, unknown>).role),
      company: toStringOrUndefined((item as Record<string, unknown>).company),
      avatarUrl: toStringOrUndefined((item as Record<string, unknown>).avatarUrl)
    } satisfies TestimonialDocument;
    if (testimonial.quote) {
      result.push(testimonial);
    }
  }
  return result.length > 0 ? result : undefined;
};

const normalizeFaqs = (items: unknown) => {
  if (!Array.isArray(items)) return undefined;
  const result = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const question = toStringOrUndefined(record.question);
      const answer = toStringOrUndefined(record.answer);
      if (!question || !answer) return null;
      return {
        question,
        answer,
        category: toStringOrUndefined(record.category)
      };
    })
    .filter(Boolean);
  return result.length > 0 ? (result as PageSectionDocument["faqItems"]) : undefined;
};

const normalizeMetrics = (items: unknown) => {
  if (!Array.isArray(items)) return undefined;
  const result = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = toStringOrUndefined(record.label);
      const value = toStringOrUndefined(record.value);
      if (!label || !value) return null;
      return {
        label,
        value,
        description: toStringOrUndefined(record.description)
      };
    })
    .filter(Boolean);
  return result.length > 0 ? result : undefined;
};

const normalizePricingTiers = (items: unknown): PricingTierDocument[] | undefined => {
  if (!Array.isArray(items)) return undefined;
  const result: PricingTierDocument[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const featuresSource = Array.isArray(record.features) ? (record.features as unknown[]) : [];
    const features = featuresSource
      .map((feature) => {
        if (!feature || typeof feature !== "object") return undefined;
        return toStringOrUndefined((feature as Record<string, unknown>).value);
      })
      .filter((feature): feature is string => typeof feature === "string" && feature.length > 0);
    const tier: PricingTierDocument = {
      name: toStringOrUndefined(record.name) ?? "",
      description: toStringOrUndefined(record.description),
      price: toNumberOrUndefined(record.price) ?? 0,
      currency: toStringOrUndefined(record.currency),
      features: features.length > 0 ? features : undefined,
      ctaLabel: toStringOrUndefined(record.ctaLabel),
      ctaHref: toStringOrUndefined(record.ctaHref),
      highlight: toBooleanOrUndefined(record.highlight)
    };
    if (tier.name) {
      result.push(tier);
    }
  }
  return result.length > 0 ? result : undefined;
};

const normalizeCaseStudy = (value: unknown): CaseStudyDocument | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const resultsSource = Array.isArray(record.results) ? (record.results as unknown[]) : [];
  const results = resultsSource
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const label = toStringOrUndefined(r.label);
      const resultValue = toStringOrUndefined(r.value);
      if (!label && !resultValue) return null;
      return {
        label,
        value: resultValue
      };
    })
    .filter(Boolean) as NonNullable<CaseStudyDocument["results"]>;
  return {
    title: toStringOrUndefined(record.title) ?? "",
    client: toStringOrUndefined(record.client),
    industry: toStringOrUndefined(record.industry),
    summary: toStringOrUndefined(record.summary),
    results: results.length > 0 ? results : undefined,
    quote: toStringOrUndefined(record.quote),
    quoteAuthor: toStringOrUndefined(record.quoteAuthor)
  };
};

const normalizeBlogSummary = (item: unknown): BlogPostSummary | null => {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const slug = toSlugObject(record.slug ?? record.id ?? record._id);
  if (!slug?.current) return null;
  return {
    title: toStringOrUndefined(record.title) ?? "",
    slug,
    excerpt: toStringOrUndefined(record.excerpt),
    publishedAt: toStringOrUndefined(record.publishedAt)
  };
};

const normalizeBlogDetail = (item: unknown) => {
  const summary = normalizeBlogSummary(item);
  if (!summary) return null;
  const record = item as Record<string, unknown>;
  return {
    ...summary,
    body: record.body
  };
};

const normalizePayloadPage = (item: unknown) => {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const contentSource = Array.isArray(record.content) ? (record.content as unknown[]) : [];
  const content = contentSource
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const blockRecord = block as Record<string, unknown>;
      const blockType = blockRecord.blockType;
      const key = toStringOrUndefined(blockRecord.id) ?? toStringOrUndefined(blockRecord.blockName);
      if (blockType === "testimonial") {
        const quote = toStringOrUndefined(blockRecord.quote);
        if (!quote) return null;
        return {
          _type: "testimonial" as const,
          _key: key,
          quote,
          author: toStringOrUndefined(blockRecord.author),
          role: toStringOrUndefined(blockRecord.role),
          company: toStringOrUndefined(blockRecord.company),
          avatarUrl: toStringOrUndefined(blockRecord.avatarUrl)
        };
      }

      const testimonialsSource = blockRecord.testimonials;
      const testimonials = Array.isArray(testimonialsSource)
        ? normalizeTestimonials(testimonialsSource)
        : testimonialsSource && typeof testimonialsSource === "object" && Array.isArray((testimonialsSource as Record<string, unknown>).docs)
          ? normalizeTestimonials((testimonialsSource as Record<string, unknown>).docs as unknown[])
          : undefined;

      const blogPostsSource = blockRecord.blogPosts;
      const blogPosts = Array.isArray(blogPostsSource)
        ? (blogPostsSource.map(normalizeBlogSummary).filter(Boolean) as BlogPostSummary[])
        : blogPostsSource && typeof blogPostsSource === "object" && Array.isArray((blogPostsSource as Record<string, unknown>).docs)
          ? (((blogPostsSource as Record<string, unknown>).docs as unknown[]).map(normalizeBlogSummary).filter(Boolean) as BlogPostSummary[])
          : undefined;

      const blockTypeName = typeof blockType === "string" ? blockType : undefined;
      const sectionLabel = key ?? blockTypeName ?? "section";
      const { nodes: marketingContent } = normalizeMarketingLexicalContent(blockRecord.content, {
        sectionLabel,
        logger: (message) => console.warn(message)
      });

      return {
        _type: "section" as const,
        _key: key,
        heading: toStringOrUndefined(blockRecord.heading),
        subheading: toStringOrUndefined(blockRecord.subheading),
        layout: toStringOrUndefined(blockRecord.layout),
        content: blockRecord.content,
        marketingContent: marketingContent.length > 0 ? marketingContent : undefined,
        metrics: normalizeMetrics(blockRecord.metrics),
        faqItems: normalizeFaqs(blockRecord.faqItems),
        testimonials,
        caseStudy: normalizeCaseStudy(blockRecord.caseStudy),
        pricingTiers: normalizePricingTiers(blockRecord.pricingTiers),
        blogPosts: blogPosts && blogPosts.length > 0 ? blogPosts : undefined
      };
    })
    .filter(Boolean);

  const heroRecord = record.hero && typeof record.hero === "object" ? (record.hero as Record<string, unknown>) : null;
  const heroCta = heroRecord?.cta && typeof heroRecord.cta === "object" ? (heroRecord.cta as Record<string, unknown>) : null;
  const hero = heroRecord
    ? {
        eyebrow: toStringOrUndefined(heroRecord.eyebrow),
        headline: toStringOrUndefined(heroRecord.headline),
        subheadline: toStringOrUndefined(heroRecord.subheadline),
        cta:
          heroCta && (toStringOrUndefined(heroCta.href) || toStringOrUndefined(heroCta.label))
            ? {
                href: toStringOrUndefined(heroCta.href),
                label: toStringOrUndefined(heroCta.label)
              }
            : undefined
      }
    : undefined;

  return {
    _id: toStringOrUndefined(record.id ?? record._id) ?? "",
    title: toStringOrUndefined(record.title) ?? "",
    hero: hero && (hero.eyebrow || hero.headline || hero.subheadline || hero.cta) ? hero : undefined,
    content: content.length > 0 ? (content as NonNullable<PageDocument["content"]>) : undefined,
    seoTitle: toStringOrUndefined(record.seoTitle),
    seoDescription: toStringOrUndefined(record.seoDescription)
  } satisfies PageDocument;
};

export const fetchHomepage = async (preview = false): Promise<PageDocument | null> => {
  try {
    if (isPayload()) {
      const env = payloadConfig.environment;
      const data = await payloadGet<{ docs?: unknown[] }>({
        path: "/api/pages",
        query: {
          "where[slug][equals]": "home",
          "where[environment][equals]": env,
          depth: 2,
          limit: 1,
          draft: preview ? "true" : undefined
        }
      });
      const doc = normalizePayloadPage(data.docs?.[0]);
      return parsePage(doc);
    } else {
      const client = getClient(preview);
      const data = await client.fetch(homepageQuery);
      return parsePage(data);
    }
  } catch (error) {
    console.warn("Failed to fetch homepage, using fallback data:", error);
    return null;
  }
};

export const getHomepage = withCache(fetchHomepage);

export const getPageBySlug = withCache(async (slug: string, preview = false): Promise<PageDocument | null> => {
  if (isPayload()) {
    const env = payloadConfig.environment;
    const data = await payloadGet<{ docs?: unknown[] }>({
      path: "/api/pages",
      query: {
        "where[slug][equals]": slug,
        "where[environment][equals]": env,
        depth: 2,
        limit: 1,
        draft: preview ? "true" : undefined
      }
    });
    const doc = normalizePayloadPage(data.docs?.[0]);
    return parsePage(doc);
  } else {
    const client = getClient(preview);
    const data = await client.fetch(pageBySlugQuery, { slug });
    return parsePage(data);
  }
});

export const getBlogPosts = withCache(async (preview = false): Promise<BlogPostSummary[]> => {
  try {
    if (isPayload()) {
      const env = payloadConfig.environment;
      const data = await payloadGet<{ docs?: unknown[] }>({
        path: "/api/blog-posts",
        query: {
          sort: "-publishedAt",
          "where[environment][equals]": env,
          draft: preview ? "true" : undefined
        }
      });
      const normalized = (Array.isArray(data.docs) ? data.docs : []).map(normalizeBlogSummary).filter(Boolean);
      const parsed = blogPostListSchema.safeParse(normalized);
      if (!parsed.success) {
        console.warn("Failed to parse blog post documents", parsed.error.flatten());
        return [];
      }
      return parsed.data;
    }
    const client = getClient(preview);
    const data = await client.fetch(blogPostsQuery);
    const parsed = blogPostListSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("Failed to parse blog post documents", parsed.error.flatten());
      return [];
    }
    return parsed.data;
  } catch (error) {
    console.warn("Failed to fetch blog posts, using fallback data:", error);
    return [];
  }
});

export const getBlogPostBySlug = withCache(async (slug: string, preview = false) => {
  if (isPayload()) {
    const env = payloadConfig.environment;
    const data = await payloadGet<{ docs?: unknown[] }>({
      path: "/api/blog-posts",
      query: {
        "where[slug][equals]": slug,
        "where[environment][equals]": env,
        depth: 2,
        limit: 1,
        draft: preview ? "true" : undefined
      }
    });
    const normalized = normalizeBlogDetail(data.docs?.[0]);
    if (!normalized) {
      return null;
    }
    const parsed = blogPostDetailSchema.safeParse(normalized);
    if (!parsed.success) {
      console.warn("Failed to parse blog post", parsed.error.flatten());
      return null;
    }
    return parsed.data;
  }
  const client = getClient(preview);
  const data = await client.fetch(blogPostBySlugQuery, { slug });
  const parsed = blogPostDetailSchema.safeParse(data);
  if (!parsed.success) {
    console.warn("Failed to parse blog post", parsed.error.flatten());
    return null;
  }
  return parsed.data;
});
