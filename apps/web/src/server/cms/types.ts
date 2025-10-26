// meta: cms-schema: marketing-content

import { z } from "zod";

const ctaSchema = z
  .object({
    label: z.string().optional(),
    href: z.string().optional()
  })
  .optional();

const testimonialSchema = z.object({
  quote: z.string(),
  author: z.string().optional(),
  role: z.string().optional(),
  company: z.string().optional(),
  avatarUrl: z.string().optional()
});

const marketingHeroSchema = z.object({
  kind: z.literal("hero"),
  key: z.string().optional(),
  eyebrow: z.string().optional(),
  headline: z.string().optional(),
  body: z.string().optional(),
  primaryCtaLabel: z.string().optional(),
  primaryCtaHref: z.string().optional(),
  secondaryCtaLabel: z.string().optional(),
  secondaryCtaHref: z.string().optional(),
  align: z.enum(["start", "center"]).optional()
});

const marketingMetricSchema = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional()
});

const marketingMetricsSchema = z.object({
  kind: z.literal("metrics"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  metrics: z.array(marketingMetricSchema)
});

const marketingTestimonialSchema = z.object({
  kind: z.literal("testimonial"),
  key: z.string().optional(),
  quote: z.string(),
  author: z.string().optional(),
  role: z.string().optional(),
  company: z.string().optional()
});

const marketingProductFeatureSchema = z.object({
  id: z.string().optional(),
  label: z.string()
});

const marketingProductSchema = z.object({
  kind: z.literal("product"),
  key: z.string().optional(),
  badge: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  frequency: z.string().optional(),
  features: z.array(marketingProductFeatureSchema),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional()
});

const marketingTimelineItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  timestamp: z.string().optional()
});

const marketingTimelineSchema = z.object({
  kind: z.literal("timeline"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  items: z.array(marketingTimelineItemSchema).min(1)
});

const marketingFeatureItemSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  icon: z.string().optional()
});

const marketingFeatureGridSchema = z.object({
  kind: z.literal("feature-grid"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  features: z.array(marketingFeatureItemSchema).min(1),
  columns: z.number().int().positive().optional()
});

const marketingMediaItemSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["image", "video"]).optional(),
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  poster: z.string().optional()
});

const marketingMediaGallerySchema = z.object({
  kind: z.literal("media-gallery"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  media: z.array(marketingMediaItemSchema).min(1),
  columns: z.number().int().positive().optional()
});

const marketingCtaItemSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  href: z.string(),
  description: z.string().optional()
});

const marketingCtaClusterSchema = z.object({
  kind: z.literal("cta-cluster"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  align: z.enum(["start", "center"]).optional(),
  ctas: z.array(marketingCtaItemSchema).min(1)
});

const marketingComparisonColumnSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  highlight: z.boolean().optional(),
  footnote: z.string().optional()
});

const marketingComparisonRowSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  values: z.array(z.union([z.string(), z.boolean(), z.null()])).default([])
});

const marketingComparisonTableSchema = z.object({
  kind: z.literal("comparison-table"),
  key: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  columns: z.array(marketingComparisonColumnSchema).min(1),
  rows: z.array(marketingComparisonRowSchema).min(1)
});

const marketingContentSchema = z.discriminatedUnion("kind", [
  marketingHeroSchema,
  marketingMetricsSchema,
  marketingTestimonialSchema,
  marketingProductSchema,
  marketingTimelineSchema,
  marketingFeatureGridSchema,
  marketingMediaGallerySchema,
  marketingCtaClusterSchema,
  marketingComparisonTableSchema
]);

const baseSection = {
  _key: z.string().optional()
} as const;

const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional()
});

const faqSchema = z.object({
  question: z.string(),
  answer: z.string(),
  category: z.string().optional()
});

const caseStudySchema = z.object({
  title: z.string(),
  client: z.string().optional(),
  industry: z.string().optional(),
  summary: z.string().optional(),
  results: z
    .array(
      z.object({
        label: z.string().optional(),
        value: z.string().optional()
      })
    )
    .optional(),
  quote: z.string().optional(),
  quoteAuthor: z.string().optional()
});

const pricingTierSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.number(),
  currency: z.string().optional(),
  features: z.array(z.string()).optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  highlight: z.boolean().optional()
});

const blogPostSchema = z.object({
  title: z.string(),
  slug: z.object({ current: z.string().optional() }).passthrough().optional(),
  excerpt: z.string().optional(),
  publishedAt: z.string().optional()
});

const sectionSchema = z.discriminatedUnion("_type", [
  z.object({
    _type: z.literal("section"),
    ...baseSection,
    heading: z.string().optional(),
    subheading: z.string().optional(),
    layout: z.string().optional(),
    content: z.any().optional(),
    marketingContent: z.array(marketingContentSchema).optional(),
    metrics: z.array(metricSchema).optional(),
    faqItems: z.array(faqSchema).optional(),
    testimonials: z.array(testimonialSchema).optional(),
    caseStudy: caseStudySchema.optional(),
    pricingTiers: z.array(pricingTierSchema).optional(),
    blogPosts: z.array(blogPostSchema).optional()
  }),
  z.object({
    _type: z.literal("testimonial"),
    ...baseSection,
    quote: z.string(),
    author: z.string().optional(),
    role: z.string().optional(),
    company: z.string().optional(),
    avatarUrl: z.string().url().optional()
  })
]);

export const pageSchema = z.object({
  _id: z.string(),
  title: z.string(),
  hero: z
    .object({
      eyebrow: z.string().optional(),
      headline: z.string().optional(),
      subheadline: z.string().optional(),
      cta: ctaSchema
    })
    .optional(),
  content: z.array(sectionSchema).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional()
});

export type PageDocument = z.infer<typeof pageSchema>;
export type MarketingContentDocument = z.infer<typeof marketingContentSchema>;
export type TestimonialDocument = z.infer<typeof testimonialSchema>;
export type FaqDocument = z.infer<typeof faqSchema>;
export type CaseStudyDocument = z.infer<typeof caseStudySchema>;
export type PricingTierDocument = z.infer<typeof pricingTierSchema>;
export type BlogPostSummary = z.infer<typeof blogPostSchema>;
export const blogPostListSchema = z.array(blogPostSchema);
export const blogPostDetailSchema = blogPostSchema.extend({
  body: z.any().optional()
});
