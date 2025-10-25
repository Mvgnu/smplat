import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const blogPostRevalidateHooks = createRevalidateHooks("blog-posts");

export const BlogPosts: CollectionConfig = {
  slug: "blog-posts",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "publishedAt", "environment"],
    description: "Long-form articles surfaced on the marketing site."
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite
  },
  hooks: {
    afterChange: [blogPostRevalidateHooks.afterChange],
    afterDelete: [blogPostRevalidateHooks.afterDelete]
  },
  versions: {
    drafts: true
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true
    },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true
    },
    {
      name: "excerpt",
      type: "textarea"
    },
    {
      name: "publishedAt",
      type: "date",
      admin: {
        date: {
          displayFormat: "MMM d, yyyy"
        }
      }
    },
    {
      name: "body",
      type: "richText",
      required: false
    },
    environmentField()
  ]
};
