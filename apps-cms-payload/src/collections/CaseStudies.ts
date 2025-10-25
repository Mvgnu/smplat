import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";

export const CaseStudies: CollectionConfig = {
  slug: "case-studies",
  admin: {
    useAsTitle: "title"
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
      name: "client",
      type: "text"
    },
    {
      name: "industry",
      type: "text"
    },
    {
      name: "summary",
      type: "textarea"
    },
    {
      name: "results",
      type: "array",
      fields: [
        {
          name: "label",
          type: "text"
        },
        {
          name: "value",
          type: "text"
        }
      ]
    },
    {
      name: "quote",
      type: "textarea"
    },
    {
      name: "quoteAuthor",
      type: "text"
    },
    environmentField()
  ]
};
