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

const timelineBlock: Block = {
  slug: "marketing-timeline",
  labels: {
    singular: "Timeline",
    plural: "Timelines"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    {
      name: "items",
      type: "array",
      minRows: 1,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "textarea" },
        { name: "timestamp", type: "text" }
      ]
    }
  ]
};

const featureGridBlock: Block = {
  slug: "marketing-feature-grid",
  labels: {
    singular: "Feature grid",
    plural: "Feature grids"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    { name: "columns", type: "number" },
    {
      name: "features",
      type: "array",
      minRows: 1,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "textarea" },
        { name: "icon", type: "text" }
      ]
    }
  ]
};

const mediaGalleryBlock: Block = {
  slug: "marketing-media-gallery",
  labels: {
    singular: "Media gallery",
    plural: "Media galleries"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    { name: "columns", type: "number" },
    {
      name: "media",
      type: "array",
      minRows: 1,
      fields: [
        {
          name: "kind",
          type: "select",
          defaultValue: "image",
          options: [
            { label: "Image", value: "image" },
            { label: "Video", value: "video" }
          ]
        },
        { name: "src", type: "text", required: true },
        { name: "alt", type: "text" },
        { name: "caption", type: "textarea" },
        { name: "poster", type: "text" }
      ]
    }
  ]
};

const ctaClusterBlock: Block = {
  slug: "marketing-cta-cluster",
  labels: {
    singular: "CTA cluster",
    plural: "CTA clusters"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
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
      name: "ctas",
      type: "array",
      minRows: 1,
      fields: [
        { name: "label", type: "text", required: true },
        { name: "href", type: "text", required: true },
        { name: "description", type: "textarea" }
      ]
    }
  ]
};

const comparisonTableBlock: Block = {
  slug: "marketing-comparison-table",
  labels: {
    singular: "Comparison table",
    plural: "Comparison tables"
  },
  fields: [
    { name: "heading", type: "text" },
    { name: "subheading", type: "textarea" },
    {
      name: "columns",
      type: "array",
      minRows: 2,
      fields: [
        { name: "label", type: "text", required: true },
        { name: "highlight", type: "checkbox" },
        { name: "footnote", type: "text" }
      ]
    },
    {
      name: "rows",
      type: "array",
      minRows: 1,
      fields: [
        { name: "label", type: "text", required: true },
        {
          name: "values",
          type: "array",
          minRows: 1,
          fields: [{ name: "value", type: "text", required: true }]
        }
      ]
    }
  ]
};

export const marketingBlocks: Block[] = [
  heroCalloutBlock,
  metricGridBlock,
  testimonialCalloutBlock,
  productCardBlock,
  timelineBlock,
  featureGridBlock,
  mediaGalleryBlock,
  ctaClusterBlock,
  comparisonTableBlock
];
