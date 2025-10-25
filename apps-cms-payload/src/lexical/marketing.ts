import type { Block } from "payload";

const heroCalloutBlock: Block = {
  slug: "marketing-hero",
  labels: {
    singular: "Hero callout",
    plural: "Hero callouts"
  },
  fields: [
    { name: "eyebrow", type: "text" },
    { name: "headline", type: "textarea" },
    { name: "body", type: "textarea" },
    {
      name: "align",
      type: "select",
      defaultValue: "center",
      options: [
        { label: "Centered", value: "center" },
        { label: "Left aligned", value: "start" }
      ]
    },
    {
      name: "primaryCtaLabel",
      label: "Primary CTA label",
      type: "text"
    },
    {
      name: "primaryCtaHref",
      label: "Primary CTA link",
      type: "text"
    },
    {
      name: "secondaryCtaLabel",
      label: "Secondary CTA label",
      type: "text"
    },
    {
      name: "secondaryCtaHref",
      label: "Secondary CTA link",
      type: "text"
    }
  ]
};

const metricGridBlock: Block = {
  slug: "marketing-metrics",
  labels: {
    singular: "Metric grid",
    plural: "Metric grids"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    {
      name: "metrics",
      type: "array",
      minRows: 1,
      fields: [
        { name: "label", type: "text", required: true },
        { name: "value", type: "text", required: true },
        { name: "description", type: "textarea" }
      ]
    }
  ]
};

const testimonialCalloutBlock: Block = {
  slug: "marketing-testimonial",
  labels: {
    singular: "Testimonial callout",
    plural: "Testimonial callouts"
  },
  fields: [
    { name: "quote", type: "textarea", required: true },
    { name: "author", type: "text" },
    { name: "role", type: "text" },
    { name: "company", type: "text" }
  ]
};

const productCardBlock: Block = {
  slug: "marketing-product-card",
  labels: {
    singular: "Product card",
    plural: "Product cards"
  },
  fields: [
    { name: "badge", type: "text" },
    { name: "name", type: "text" },
    { name: "description", type: "textarea" },
    { name: "price", type: "number" },
    { name: "currency", type: "text", defaultValue: "USD" },
    { name: "frequency", type: "text" },
    {
      name: "features",
      type: "array",
      fields: [{ name: "label", type: "text", required: true }]
    },
    { name: "ctaLabel", type: "text" },
    { name: "ctaHref", type: "text" }
  ]
};

export const marketingBlocks: Block[] = [
  heroCalloutBlock,
  metricGridBlock,
  testimonialCalloutBlock,
  productCardBlock
];
