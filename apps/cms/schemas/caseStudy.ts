import { defineField, defineType } from "sanity";

export default defineType({
  name: "caseStudy",
  title: "Case Study",
  type: "document",
  fields: [
    defineField({ name: "title", title: "Title", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "client", title: "Client", type: "string" }),
    defineField({ name: "industry", title: "Industry", type: "string" }),
    defineField({ name: "summary", title: "Summary", type: "text" }),
    defineField({
      name: "results",
      title: "Results",
      type: "array",
      of: [
        defineField({
          name: "result",
          title: "Result",
          type: "object",
          fields: [
            { name: "label", title: "Label", type: "string" },
            { name: "value", title: "Value", type: "string" }
          ]
        })
      ]
    }),
    defineField({ name: "quote", title: "Pull Quote", type: "text" }),
    defineField({ name: "quoteAuthor", title: "Quote Author", type: "string" })
  ]
});
