import { createClient } from "@sanity/client";
import { cmsProvider, sanityConfig, sanityPreviewToken, payloadConfig } from "./config";

export const sanityClient = createClient({
  ...sanityConfig,
  token: sanityPreviewToken
});

export const previewClient = createClient({
  ...sanityConfig,
  token: sanityPreviewToken,
  useCdn: false
});

export const getClient = (preview = false) => (preview ? previewClient : sanityClient);

type FetchOptions = { path: string; query?: Record<string, string | number | boolean | undefined> };

const buildUrl = ({ path, query }: FetchOptions) => {
  const url = new URL(path, payloadConfig.baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
};

export const payloadFetch = async <T>({ path, query }: FetchOptions): Promise<T> => {
  const url = buildUrl({ path, query });
  const res = await fetch(url, {
    headers: payloadConfig.token ? { Authorization: `Bearer ${payloadConfig.token}` } : undefined
  });
  if (!res.ok) {
    throw new Error(`Payload request failed ${res.status} ${res.statusText}: ${url}`);
  }
  const json = await res.json();
  return json as T;
};

export const isPayload = () => cmsProvider === "payload";
