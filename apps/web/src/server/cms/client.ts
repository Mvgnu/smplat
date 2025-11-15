import { draftMode } from "next/headers";

import { createClient } from "@sanity/client";

import {
  cmsProvider,
  payloadConfig,
  payloadPreviewSecret,
  sanityConfig,
  sanityPreviewToken
} from "./config";

export { payloadConfig };

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

export const isPayload = () => cmsProvider === "payload";

type Primitive = string | number | boolean;

type QueryValue = Primitive | null | undefined | Primitive[];

type FetchOptions = {
  path: string;
  query?: Record<string, QueryValue>;
};

export type PayloadRequestMethod = "GET" | "POST" | "PATCH";

export type PayloadRequestOptions<TBody = unknown> = FetchOptions & {
  method?: PayloadRequestMethod;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

const defaultHeaders = (options?: { includePreviewSecret?: boolean }) => {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (payloadConfig.token) {
    headers.Authorization = `Bearer ${payloadConfig.token}`;
  }
  if (options?.includePreviewSecret && payloadPreviewSecret) {
    headers["x-payload-preview"] = payloadPreviewSecret;
  }
  return headers;
};

// meta: preview-draft-support:enabled
const isDraftEnabled = () => {
  try {
    return draftMode().isEnabled;
  } catch (error) {
    console.warn("[payload] failed to read draft mode state", error);
    return false;
  }
};

const serializeQueryValue = (value: QueryValue) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
};

const buildUrl = ({ path, query }: FetchOptions) => {
  const url = new URL(path, payloadConfig.baseUrl);
  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      const serialized = serializeQueryValue(rawValue);
      if (serialized === undefined) continue;
      if (Array.isArray(serialized)) {
        url.searchParams.delete(key);
        for (const entry of serialized) {
          url.searchParams.append(key, entry);
        }
      } else {
        url.searchParams.set(key, serialized);
      }
    }
  }
  return url.toString();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PayloadRequestError extends Error {
  status: number;
  statusText: string;
  url: string;

  constructor(url: string, status: number, statusText: string, message?: string) {
    super(message ?? `Payload request failed ${status} ${statusText}`);
    this.name = "PayloadRequestError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

const logRetry = (attempt: number, error: unknown) => {
  console.warn(`[payload] retrying request (attempt ${attempt})`, error);
};

const hasContentType = (headers: Record<string, string>) =>
  Object.keys(headers).some((key) => key.toLowerCase() === "content-type");

const createRequestInit = (options: PayloadRequestOptions, includePreviewSecret: boolean): RequestInit => {
  const headers = {
    ...defaultHeaders({ includePreviewSecret }),
    ...(options.headers ?? {})
  } satisfies Record<string, string>;

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: options.signal
  };

  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob) {
      init.body = options.body as BodyInit;
    } else if (typeof options.body === "string") {
      init.body = options.body;
    } else {
      init.body = JSON.stringify(options.body);
      if (!hasContentType(headers)) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  return init;
};

export const payloadFetch = async <TResponse, TBody = unknown>(
  options: PayloadRequestOptions<TBody>
): Promise<TResponse> => {
  const draft = isDraftEnabled();
  const query = { ...options.query };
  if (draft) {
    query.draft = true;
  }
  const url = buildUrl({ path: options.path, query });
  const retries = Math.max(1, options.retries ?? 1);
  const retryDelayMs = options.retryDelayMs ?? 200;
  const onRetry = options.onRetry ?? logRetry;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    attempt += 1;
    try {
      const init = createRequestInit(options, draft);
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new PayloadRequestError(url, response.status, response.statusText);
      }
      const json = (await response.json()) as TResponse;
      return json;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      onRetry(attempt, error);
      await sleep(retryDelayMs);
    }
  }

  if (lastError instanceof PayloadRequestError) {
    throw lastError;
  }

  throw new Error(`Payload request failed after ${retries} attempts: ${url}`);
};

export const payloadGet = async <TResponse>(
  options: Omit<PayloadRequestOptions<never>, "method" | "body">
): Promise<TResponse> => {
  return payloadFetch<TResponse>({ ...options, method: "GET" });
};

export const payloadPost = async <TResponse, TBody = unknown>(
  options: Omit<PayloadRequestOptions<TBody>, "method">
): Promise<TResponse> => {
  return payloadFetch<TResponse, TBody>({ ...options, method: "POST" });
};

export const payloadPatch = async <TResponse, TBody = unknown>(
  options: Omit<PayloadRequestOptions<TBody>, "method">
): Promise<TResponse> => {
  return payloadFetch<TResponse, TBody>({ ...options, method: "PATCH" });
};
