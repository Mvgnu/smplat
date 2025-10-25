import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";

export const SiteSettings: CollectionConfig = {
  slug: "site-settings",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "environment"]
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
      name: "tagline",
      type: "textarea"
    },
    {
      name: "heroCta",
      type: "group",
      fields: [
        {
          name: "label",
          type: "text"
        },
        {
          name: "href",
          type: "text"
        }
      ]
    },
    environmentField()
  ]
};
