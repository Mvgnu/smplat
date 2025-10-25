import type { CollectionConfig } from "payload";

export const Users: CollectionConfig = {
  slug: "users",
  auth: true,
  admin: {
    useAsTitle: "email"
  },
  access: {
    read: () => false,
    create: () => true,
    update: () => true,
    delete: () => true
  },
  fields: [
    {
      name: "name",
      type: "text",
      required: false
    }
  ]
};
