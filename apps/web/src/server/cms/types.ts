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
export type TestimonialDocument = z.infer<typeof testimonialSchema>;
export type FaqDocument = z.infer<typeof faqSchema>;
export type CaseStudyDocument = z.infer<typeof caseStudySchema>;
export type PricingTierDocument = z.infer<typeof pricingTierSchema>;
export type BlogPostSummary = z.infer<typeof blogPostSchema>;
export const blogPostListSchema = z.array(blogPostSchema);
export const blogPostDetailSchema = blogPostSchema.extend({
  body: z.any().optional()
});
