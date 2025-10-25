import { defineField, defineType } from "sanity";

export default defineType({
  name: "section",
  title: "Content Section",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Heading", type: "string" }),
    defineField({ name: "subheading", title: "Subheading", type: "text" }),
    defineField({
      name: "layout",
      title: "Layout",
      type: "string",
      options: {
        list: [
          { title: "Two Column", value: "two-column" },
          { title: "Feature Grid", value: "feature-grid" },
          { title: "Metrics", value: "metrics" },
          { title: "FAQs", value: "faq" },
          { title: "Testimonials", value: "testimonials" },
          { title: "Case Study", value: "case-study" },
          { title: "Pricing", value: "pricing" },
          { title: "Blog Highlights", value: "blog" }
        ]
      },
      initialValue: "two-column"
    }),
    defineField({
      name: "content",
      title: "Content",
      type: "array",
      of: [{ type: "block" }]
    }),
    defineField({
      name: "metrics",
      title: "Metrics",
      type: "array",
      of: [
        defineField({
          name: "metric",
          title: "Metric",
          type: "object",
          fields: [
            { name: "label", title: "Label", type: "string" },
            { name: "value", title: "Value", type: "string" },
            { name: "description", title: "Description", type: "string" }
          ]
        })
      ]
    }),
    defineField({
      name: "faqItems",
      title: "FAQ items",
      type: "array",
      of: [{ type: "reference", to: [{ type: "faq" }] }]
    }),
    defineField({
      name: "testimonials",
      title: "Testimonials",
      type: "array",
      of: [{ type: "reference", to: [{ type: "testimonial" }] }]
    }),
    defineField({
      name: "caseStudy",
      title: "Case Study",
      type: "reference",
      to: [{ type: "caseStudy" }]
    }),
    defineField({
      name: "pricingTiers",
      title: "Pricing Tiers",
      type: "array",
      of: [{ type: "reference", to: [{ type: "pricingTier" }] }]
    }),
    defineField({
      name: "blogPosts",
      title: "Featured Blog Posts",
      type: "array",
      of: [{ type: "reference", to: [{ type: "blogPost" }] }]
    })
  ]
});
