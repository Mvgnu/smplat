import type { Block, CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";

const sectionBlock: Block = {
  slug: "section",
  labels: {
    singular: "Section",
    plural: "Sections"
  },
  fields: [
    {
      name: "layout",
      type: "select",
      options: [
        { label: "Two Column", value: "two-column" },
        { label: "Metrics", value: "metrics" },
        { label: "Case Study", value: "case-study" },
        { label: "FAQ", value: "faq" },
        { label: "Testimonials", value: "testimonials" },
        { label: "Pricing", value: "pricing" },
        { label: "Blog", value: "blog" }
      ]
    },
    {
      name: "heading",
      type: "text"
    },
    {
      name: "subheading",
      type: "textarea"
    },
    {
      name: "content",
      type: "richText",
      required: false
    },
    {
      name: "metrics",
      type: "array",
      fields: [
        { name: "label", type: "text" },
        { name: "value", type: "text" },
        { name: "description", type: "textarea" }
      ]
    },
    {
      name: "faqItems",
      type: "relationship",
      relationTo: "faqs",
      hasMany: true
    },
    {
      name: "testimonials",
      type: "relationship",
      relationTo: "testimonials",
      hasMany: true
    },
    {
      name: "caseStudy",
      type: "relationship",
      relationTo: "case-studies"
    },
    {
      name: "pricingTiers",
      type: "relationship",
      relationTo: "pricing-tiers",
      hasMany: true
    },
    {
      name: "blogPosts",
      type: "relationship",
      relationTo: "blog-posts",
      hasMany: true
    }
  ]
};

const testimonialHighlightBlock: Block = {
  slug: "testimonial",
  labels: {
    singular: "Standalone testimonial",
    plural: "Standalone testimonials"
  },
  fields: [
    {
      name: "quote",
      type: "textarea",
      required: true
    },
    {
      name: "author",
      type: "text"
    },
    {
      name: "role",
      type: "text"
    },
    {
      name: "company",
      type: "text"
    },
    {
      name: "avatarUrl",
      type: "text"
    }
  ]
};

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "environment"],
    description: "Marketing pages rendered by the Next.js frontend."
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true
    },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true
    },
    {
      name: "hero",
      type: "group",
      fields: [
        { name: "eyebrow", type: "text" },
        { name: "headline", type: "textarea" },
        { name: "subheadline", type: "textarea" },
        {
          name: "cta",
          type: "group",
          fields: [
            { name: "label", type: "text" },
            { name: "href", type: "text" }
          ]
        }
      ]
    },
    {
      name: "content",
      type: "blocks",
      blocks: [sectionBlock, testimonialHighlightBlock]
    },
    {
      name: "seoTitle",
      type: "text"
    },
    {
      name: "seoDescription",
      type: "textarea"
    },
    environmentField()
  ]
};
