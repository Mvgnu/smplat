import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const caseStudyRevalidateHooks = createRevalidateHooks("case-studies");

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
  hooks: {
    afterChange: [caseStudyRevalidateHooks.afterChange],
    afterDelete: [caseStudyRevalidateHooks.afterDelete]
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
