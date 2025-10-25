import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const testimonialRevalidateHooks = createRevalidateHooks("testimonials");

export const Testimonials: CollectionConfig = {
  slug: "testimonials",
  admin: {
    useAsTitle: "author"
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite
  },
  hooks: {
    afterChange: [testimonialRevalidateHooks.afterChange],
    afterDelete: [testimonialRevalidateHooks.afterDelete]
  },
  fields: [
    {
      name: "quote",
      type: "textarea",
      required: true
    },
    {
      name: "author",
      type: "text"
    },
    {
      name: "role",
      type: "text"
    },
    {
      name: "company",
      type: "text"
    },
    {
      name: "avatarUrl",
      type: "text"
    },
    environmentField()
  ]
};
