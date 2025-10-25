export const sanityConfig = {
  projectId: process.env.SANITY_PROJECT_ID ?? "smplat",
  dataset: process.env.SANITY_DATASET ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
  apiVersion: process.env.SANITY_API_VERSION ?? "2025-10-15",
  useCdn: process.env.NODE_ENV === "production" && !process.env.SANITY_READ_TOKEN
};

export const sanityPreviewToken = process.env.SANITY_READ_TOKEN;

export type CmsProvider = "sanity" | "payload";

export const cmsProvider: CmsProvider = (process.env.CMS_PROVIDER as CmsProvider) || "sanity";

export const payloadConfig = {
  baseUrl: process.env.PAYLOAD_URL || "http://localhost:3050",
  environment: process.env.CMS_ENV || (process.env.NODE_ENV === "production" ? "production" : process.env.PLAYWRIGHT_WORKER_ID ? "test" : "development"),
  token: process.env.PAYLOAD_API_TOKEN
};
