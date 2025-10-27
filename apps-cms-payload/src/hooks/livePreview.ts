import { randomUUID } from "node:crypto";

import type { CollectionAfterChangeHook } from "payload/types";

// meta: payload-hook: live-preview

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const LIVE_PREVIEW_ENDPOINT =
  process.env.PAYLOAD_LIVE_PREVIEW_ENDPOINT || `${WEB_URL}/api/marketing-preview/stream`;
const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
};

const extractIdentifier = (doc?: Record<string, unknown> | null) => {
  if (!doc || typeof doc !== "object") {
    return null;
  }
  const possibleKeys = ["id", "_id", "slug"] as const;
  for (const key of possibleKeys) {
    const value = doc[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (key === "slug" && value && typeof value === "object" && "current" in value) {
      const current = (value as { current?: unknown }).current;
      if (typeof current === "string" && current.trim().length > 0) {
        return current;
      }
    }
  }
  return null;
};

const extractEnvironment = (doc?: Record<string, unknown> | null): string | undefined => {
  if (!doc || typeof doc !== "object") {
    return undefined;
  }
  const value = doc.environment;
  return typeof value === "string" ? value : undefined;
};

type LexicalSection = {
  id?: string;
  heading?: string;
  subheading?: string;
  content?: unknown;
};

type LivePreviewOptions = {
  resolveRoute?: (doc: Record<string, unknown>) => string | null;
  resolveLabel?: (doc: Record<string, unknown>) => string | null;
  selectLexicalSections?: (doc: Record<string, unknown>) => LexicalSection[];
};

const defaultRouteResolver = (doc: Record<string, unknown>): string | null => {
  const slug = toNonEmptyString(doc.slug);
  if (!slug) {
    return null;
  }
  if (slug === "home" || slug === "homepage" || slug === "/") {
    return "/";
  }
  return slug.startsWith("/") ? slug : `/${slug}`;
};

const defaultLabelResolver = (doc: Record<string, unknown>): string | null => {
  return toNonEmptyString(doc.title) ?? toNonEmptyString(doc.label) ?? null;
};

const defaultLexicalSelector = (doc: Record<string, unknown>): LexicalSection[] => {
  const content = Array.isArray(doc.content) ? (doc.content as unknown[]) : [];
  const sections: LexicalSection[] = [];

  for (const section of content) {
    if (!section || typeof section !== "object") {
      continue;
    }
    const record = section as Record<string, unknown>;
    const blockType = toNonEmptyString(record.blockType) ?? toNonEmptyString(record._type);
    if (blockType !== "section") {
      continue;
    }
    const lexical = record.content;
    if (!lexical) {
      continue;
    }
    sections.push({
      id: toNonEmptyString(record.id) ?? toNonEmptyString(record._id),
      heading: toNonEmptyString(record.heading),
      subheading: toNonEmptyString(record.subheading),
      content: lexical
    });
  }

  return sections;
};

const buildPayload = (
  collection: string,
  doc: Record<string, unknown>,
  previousDoc: Record<string, unknown> | null,
  options: LivePreviewOptions
) => {
  const lexical = (options.selectLexicalSections ?? defaultLexicalSelector)(doc);
  if (!lexical.length) {
    return null;
  }

  const route = (options.resolveRoute ?? defaultRouteResolver)(doc);
  if (!route) {
    return null;
  }

  const requestId = (globalThis.crypto?.randomUUID?.() ?? randomUUID());
  const environment =
    extractEnvironment(doc) ?? extractEnvironment(previousDoc) ?? null;

  return {
    requestId,
    collection,
    docId: extractIdentifier(doc),
    slug: toNonEmptyString(doc.slug),
    route,
    label: (options.resolveLabel ?? defaultLabelResolver)(doc),
    environment,
    updatedAt: toNonEmptyString(doc.updatedAt) ?? new Date().toISOString(),
    title: toNonEmptyString(doc.title),
    hero: doc.hero as Record<string, unknown> | null | undefined,
    lexical
  };
};

const sendLivePreview = async (
  payload: ReturnType<typeof buildPayload>,
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void }
) => {
  if (!payload) {
    return;
  }

  if (!LIVE_PREVIEW_SECRET) {
    logger?.warn?.("[payload] live preview secret not configured", {
      collection: payload.collection,
      route: payload.route
    });
    return;
  }

  try {
    const response = await fetch(LIVE_PREVIEW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-preview-signature": LIVE_PREVIEW_SECRET,
        "x-cms-provider": "payload"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger?.warn?.("[payload] live preview broadcast failed", {
        collection: payload.collection,
        route: payload.route,
        status: response.status,
        statusText: response.statusText,
        responseBody,
        requestId: payload.requestId
      });
    }
  } catch (error) {
    logger?.warn?.("[payload] live preview request failed", {
      collection: payload.collection,
      route: payload.route,
      error: error instanceof Error ? error.message : String(error),
      requestId: payload.requestId
    });
  }
};

export const createLivePreviewPublisher = (
  collection: string,
  options: LivePreviewOptions = {}
) => {
  const afterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
    const currentDoc = (doc ?? previousDoc ?? {}) as Record<string, unknown>;
    const payload = buildPayload(collection, currentDoc, previousDoc as Record<string, unknown> | null, options);

    await sendLivePreview(
      payload
        ? {
            ...payload,
            collection
          }
        : null,
      req.payload?.logger
    );

    return doc;
  };

  return { afterChange };
};
