import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const pricingRevalidateHooks = createRevalidateHooks("pricing-tiers");

export const PricingTiers: CollectionConfig = {
  slug: "pricing-tiers",
  admin: {
    useAsTitle: "name"
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite
  },
  hooks: {
    afterChange: [pricingRevalidateHooks.afterChange],
    afterDelete: [pricingRevalidateHooks.afterDelete]
  },
  fields: [
    {
      name: "name",
      type: "text",
      required: true
    },
    {
      name: "description",
      type: "textarea"
    },
    {
      name: "price",
      type: "number"
    },
    {
      name: "currency",
      type: "text",
      defaultValue: "EUR"
    },
    {
      name: "features",
      type: "array",
      fields: [
        {
          name: "value",
          type: "text",
          required: true
        }
      ]
    },
    {
      name: "ctaLabel",
      type: "text"
    },
    {
      name: "ctaHref",
      type: "text"
    },
    {
      name: "highlight",
      type: "checkbox",
      defaultValue: false
    },
    environmentField()
  ]
};
