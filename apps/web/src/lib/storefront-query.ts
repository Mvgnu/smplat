import type { ReadonlyURLSearchParams } from "next/navigation";

export const STOREFRONT_QUERY_PARAMS = {
  platform: "platform",
  experiment: "experiment",
  variant: "variant",
  loyaltyCampaign: "loyaltyCampaign",
} as const;

export type StorefrontQueryParamKey = keyof typeof STOREFRONT_QUERY_PARAMS;

export type StorefrontQueryParams = Partial<Record<StorefrontQueryParamKey, string>>;

const sanitizeValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readFromUrl = (params: URLSearchParams | ReadonlyURLSearchParams): StorefrontQueryParams => {
  const entries: [StorefrontQueryParamKey, string | undefined][] = [
    ["platform", sanitizeValue(params.get(STOREFRONT_QUERY_PARAMS.platform))],
    ["experiment", sanitizeValue(params.get(STOREFRONT_QUERY_PARAMS.experiment))],
    ["variant", sanitizeValue(params.get(STOREFRONT_QUERY_PARAMS.variant))],
    ["loyaltyCampaign", sanitizeValue(params.get(STOREFRONT_QUERY_PARAMS.loyaltyCampaign))],
  ];
  return Object.fromEntries(
    entries.filter(([, value]) => value !== undefined) as [StorefrontQueryParamKey, string][]
  );
};

export function readStorefrontQueryParams(
  source?: URLSearchParams | ReadonlyURLSearchParams | string | Record<string, unknown> | null
): StorefrontQueryParams {
  if (!source) {
    return {};
  }
  if (typeof source === "string") {
    try {
      const params = new URLSearchParams(source.startsWith("?") ? source.slice(1) : source);
      return readFromUrl(params);
    } catch {
      return {};
    }
  }
  if (typeof source === "object" && "get" in source && typeof source.get === "function") {
    return readFromUrl(source as URLSearchParams | ReadonlyURLSearchParams);
  }
  if (typeof source === "object") {
    const record = source as Record<string, unknown>;
    const params: StorefrontQueryParams = {};
    (Object.keys(STOREFRONT_QUERY_PARAMS) as StorefrontQueryParamKey[]).forEach((key) => {
      const value = sanitizeValue(record[key]);
      if (value) {
        params[key] = value;
      }
    });
    return params;
  }
  return {};
}

export function buildStorefrontQueryString(params: StorefrontQueryParams): string {
  const searchParams = new URLSearchParams();
  (Object.keys(STOREFRONT_QUERY_PARAMS) as StorefrontQueryParamKey[]).forEach((key) => {
    const value = params[key];
    if (value) {
      searchParams.set(STOREFRONT_QUERY_PARAMS[key], value);
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function mergeStorefrontParamsIntoUrl(
  target: string | URL,
  params: StorefrontQueryParams
): string {
  const url = typeof target === "string" ? new URL(target, "http://localhost") : new URL(target.toString());
  (Object.keys(STOREFRONT_QUERY_PARAMS) as StorefrontQueryParamKey[]).forEach((key) => {
    const value = params[key];
    if (value) {
      url.searchParams.set(STOREFRONT_QUERY_PARAMS[key], value);
    } else {
      url.searchParams.delete(STOREFRONT_QUERY_PARAMS[key]);
    }
  });
  const relativePath = url.pathname + (url.search ? url.search : "") + (url.hash ?? "");
  return url.origin === "http://localhost" ? relativePath : url.toString();
}
