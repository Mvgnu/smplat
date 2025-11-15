import type { CollectionConfig } from "payload";

export const Users: CollectionConfig = {
	slug: "users",
	auth: true,
	admin: {
		useAsTitle: "email"
	},
	access: {
		read: ({ req }) => Boolean(req.user),
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
