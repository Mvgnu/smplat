import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";

export const Faqs: CollectionConfig = {
  slug: "faqs",
  admin: {
    useAsTitle: "question"
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite
  },
  fields: [
    {
      name: "question",
      type: "text",
      required: true
    },
    {
      name: "answer",
      type: "textarea",
      required: true
    },
    {
      name: "category",
      type: "text"
    },
    environmentField()
  ]
};
