export type Environment = "development" | "staging" | "production";

export const PRODUCT_CATEGORIES = ["instagram-growth", "account-management", "analytics"] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export * from "./email";
