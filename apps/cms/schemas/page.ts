import { defineArrayMember, defineField, defineType } from "sanity";

export default defineType({
  name: "page",
  title: "Page",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Title", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "slug", title: "Slug", type: "slug", options: { source: "title", maxLength: 96 } }),
    defineField({
      name: "hero",
      title: "Hero",
      type: "object",
      fields: [
        { name: "eyebrow", title: "Eyebrow", type: "string" },
        { name: "headline", title: "Headline", type: "string", validation: (rule) => rule.required() },
        { name: "subheadline", title: "Subheadline", type: "text" },
        {
          name: "cta",
          title: "Primary CTA",
          type: "object",
          fields: [
            { name: "label", type: "string", title: "Label" },
            { name: "href", type: "url", title: "Link" }
          ]
        }
      ]
    }),
    defineField({
      name: "content",
      title: "Content Sections",
      type: "array",
      of: [
        defineArrayMember({ type: "section" }),
        defineArrayMember({ type: "reference", to: [{ type: "testimonial" }] })
      ]
    }),
    defineField({ name: "seoTitle", title: "SEO Title", type: "string" }),
    defineField({ name: "seoDescription", title: "SEO Description", type: "text" })
  ]
});
