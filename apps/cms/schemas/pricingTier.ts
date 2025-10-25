import { defineField, defineType } from "sanity";

export default defineType({
  name: "pricingTier",
  title: "Pricing Tier",
  type: "document",
  fields: [
    defineField({ name: "name", title: "Name", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "description", title: "Description", type: "text" }),
    defineField({ name: "price", title: "Price", type: "number", validation: (rule) => rule.required() }),
    defineField({ name: "currency", title: "Currency", type: "string", initialValue: "EUR" }),
    defineField({
      name: "features",
      title: "Features",
      type: "array",
      of: [{ type: "string" }]
    }),
    defineField({ name: "ctaLabel", title: "CTA Label", type: "string" }),
    defineField({ name: "ctaHref", title: "CTA Link", type: "url" }),
    defineField({ name: "highlight", title: "Highlight", type: "boolean", initialValue: false })
  ]
});
