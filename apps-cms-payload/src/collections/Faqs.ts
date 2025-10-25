import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const faqRevalidateHooks = createRevalidateHooks("faqs");

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
  hooks: {
    afterChange: [faqRevalidateHooks.afterChange],
    afterDelete: [faqRevalidateHooks.afterDelete]
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
