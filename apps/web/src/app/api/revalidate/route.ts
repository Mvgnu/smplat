import { revalidatePath } from "next/cache";

import {
  cmsProvider,
  payloadConfig,
  resolveRevalidateSecret,
  type CmsProvider
} from "@/server/cms/config";

const SANITY_SIGNATURE_HEADER = "x-sanity-signature";
const PAYLOAD_SIGNATURE_HEADER = "x-payload-signature";
const PROVIDER_HEADER = "x-cms-provider";

type SanityRevalidatePayload = {
  slug?: { current?: string };
  _type?: string;
};

type PayloadWebhook = {
  collection?: string;
  doc?: Record<string, unknown> | null;
  previousDoc?: Record<string, unknown> | null;
  paths?: unknown;
  environment?: unknown;
};

const toProvider = (value: string | null | undefined): CmsProvider | undefined => {
  if (value === "sanity" || value === "payload") {
    return value;
  }
  return undefined;
};

const mapSanitySlugToPath = (slug?: string) => {
  if (!slug || slug === "home") {
    return "/";
  }
  return `/${slug}`;
};

const ensureLeadingSlash = (path: string) => {
  if (!path.startsWith("/")) {
    return `/${path.replace(/^\/+/, "")}`;
  }
  return path;
};

const extractString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const extractSlug = (record: Record<string, unknown> | null | undefined): string | undefined => {
  if (!record) {
    return undefined;
  }
  const direct = extractString(record.slug);
  if (direct) {
    return direct;
  }
  const slugObject = record.slug;
  if (slugObject && typeof slugObject === "object") {
    const slugValue = extractString((slugObject as Record<string, unknown>).slug);
    if (slugValue) {
      return slugValue;
    }
    const currentValue = extractString((slugObject as Record<string, unknown>).current);
    if (currentValue) {
      return currentValue;
    }
  }
  const id = extractString(record.id) ?? extractString(record._id);
  return id ?? undefined;
};

const extractEnvironment = (payload: PayloadWebhook): string | undefined => {
  const fromPayload = extractString(payload.environment);
  if (fromPayload) {
    return fromPayload;
  }
  const doc = payload.doc ?? payload.previousDoc;
  if (doc && typeof doc === "object") {
    return extractString(doc.environment);
  }
  return undefined;
};

const normalizePaths = (paths: unknown): string[] | undefined => {
  if (Array.isArray(paths)) {
    const normalized = paths
      .map((path) => (typeof path === "string" ? ensureLeadingSlash(path) : null))
      .filter(Boolean) as string[];
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }
  if (typeof paths === "string" && paths.length > 0) {
    return [ensureLeadingSlash(paths)];
  }
  return undefined;
};

const resolvePayloadPaths = (payload: PayloadWebhook): string[] => {
  const pathsFromPayload = normalizePaths(payload.paths);
  if (pathsFromPayload) {
    return pathsFromPayload;
  }

  const doc = payload.doc ?? payload.previousDoc ?? undefined;
  const slug = doc && typeof doc === "object" ? extractSlug(doc as Record<string, unknown>) : undefined;
  const collection = payload.collection;

  if (collection === "pages") {
    if (!slug || slug === "home") {
      return ["/"];
    }
    return [ensureLeadingSlash(slug)];
  }

  if (collection === "blog-posts") {
    if (!slug) {
      return ["/blog"];
    }
    return ["/blog", `/blog/${slug}`];
  }

  if (collection === "site-settings") {
    return ["/", "/blog"];
  }

  return ["/"];
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const providerFromHeader = toProvider(request.headers.get(PROVIDER_HEADER));
  const providerFromQuery = toProvider(url.searchParams.get("provider"));
  const defaultProvider = providerFromHeader ?? providerFromQuery ?? cmsProvider;

  const providersToCheck: CmsProvider[] =
    defaultProvider === "payload" ? ["payload", "sanity"] : ["sanity", "payload"];

  const authorizedProvider = providersToCheck.find((candidate) => {
    const expected = resolveRevalidateSecret(candidate);
    if (!expected) {
      return false;
    }
    const header = candidate === "payload" ? PAYLOAD_SIGNATURE_HEADER : SANITY_SIGNATURE_HEADER;
    const received = request.headers.get(header);
    return received === expected;
  });

  if (!authorizedProvider) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const secret = resolveRevalidateSecret(authorizedProvider);
  if (!secret) {
    return Response.json({ error: "Revalidate secret not configured" }, { status: 500 });
  }

  if (authorizedProvider === "sanity") {
    const payload = (await request.json()) as SanityRevalidatePayload;
    const slug = payload.slug?.current;
    const path = mapSanitySlugToPath(slug);
    revalidatePath(path);
    return Response.json({ revalidated: true, provider: authorizedProvider, paths: [path] });
  }

  const payload = (await request.json()) as PayloadWebhook;
  const environment = extractEnvironment(payload);
  const expectedEnvironment = payloadConfig.environment;
  if (environment && expectedEnvironment && environment !== expectedEnvironment) {
    return Response.json(
      {
        revalidated: false,
        provider: authorizedProvider,
        reason: "Environment mismatch",
        environment,
        expectedEnvironment
      },
      { status: 202 }
    );
  }

  const paths = resolvePayloadPaths(payload);
  const uniquePaths = Array.from(new Set(paths.map(ensureLeadingSlash)));
  uniquePaths.forEach((path) => revalidatePath(path));

  return Response.json({ revalidated: true, provider: authorizedProvider, paths: uniquePaths });
}
