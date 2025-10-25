export const sanityConfig = {
  projectId: process.env.SANITY_PROJECT_ID ?? "smplat",
  dataset: process.env.SANITY_DATASET ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
  apiVersion: process.env.SANITY_API_VERSION ?? "2025-10-15",
  useCdn: process.env.NODE_ENV === "production" && !process.env.SANITY_READ_TOKEN
};

export const sanityPreviewToken = process.env.SANITY_READ_TOKEN;

export const sanityPreviewSecret = process.env.SANITY_PREVIEW_SECRET;
export const sanityRevalidateSecret = process.env.SANITY_REVALIDATE_SECRET;

export type CmsProvider = "sanity" | "payload";

const configuredProvider = process.env.CMS_PROVIDER as CmsProvider | undefined;

export const cmsProvider: CmsProvider = configuredProvider === "sanity" ? "sanity" : "payload";

export const payloadPreviewSecret = process.env.PAYLOAD_PREVIEW_SECRET;
export const payloadRevalidateSecret = process.env.PAYLOAD_REVALIDATE_SECRET;

const providerSecrets = {
  sanity: {
    preview: sanityPreviewSecret,
    revalidate: sanityRevalidateSecret
  },
  payload: {
    preview: payloadPreviewSecret,
    revalidate: payloadRevalidateSecret
  }
} as const satisfies Record<CmsProvider, { preview: string | undefined; revalidate: string | undefined }>;

export const resolvePreviewSecret = (provider: CmsProvider = cmsProvider) => providerSecrets[provider].preview;

export const resolveRevalidateSecret = (provider: CmsProvider = cmsProvider) => providerSecrets[provider].revalidate;

export const payloadConfig = {
  baseUrl: process.env.PAYLOAD_URL || "http://localhost:3050",
  environment: process.env.CMS_ENV || (process.env.NODE_ENV === "production" ? "production" : process.env.PLAYWRIGHT_WORKER_ID ? "test" : "development"),
  token: process.env.PAYLOAD_API_TOKEN
};
