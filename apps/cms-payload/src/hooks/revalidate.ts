import { randomUUID } from "node:crypto";

import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from "payload/types";

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const REVALIDATE_ENDPOINT = process.env.PAYLOAD_REVALIDATE_ENDPOINT || `${WEB_URL}/api/revalidate`;
const REVALIDATE_SECRET = process.env.PAYLOAD_REVALIDATE_SECRET;
const ENVIRONMENT_FALLBACK = process.env.CMS_ENV;
const PROVIDER_HEADER = "x-cms-provider";

type Logger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type RevalidatePayload = {
  collection: string;
  doc?: Record<string, unknown> | null;
  previousDoc?: Record<string, unknown> | null;
  environment?: string | null;
  docId?: string | null;
  previousDocId?: string | null;
  requestId?: string;
};

const extractEnvironment = (doc?: Record<string, unknown> | null): string | undefined => {
  if (!doc || typeof doc !== "object") {
    return undefined;
  }
  const value = doc.environment;
  return typeof value === "string" ? value : undefined;
};

const sendRevalidateRequest = async (payload: RevalidatePayload, logger?: Logger) => {
  if (!REVALIDATE_SECRET) {
    logger?.warn?.("[payload] revalidate secret not configured", {
      collection: payload.collection
    });
    return;
  }

  // meta: payload-revalidate:request-id
  const requestId = (globalThis.crypto?.randomUUID?.() ?? randomUUID());
  const body = JSON.stringify({ ...payload, requestId });

  try {
    const response = await fetch(REVALIDATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-payload-signature": REVALIDATE_SECRET,
        [PROVIDER_HEADER]: "payload"
      },
      body
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger?.warn?.("[payload] revalidate request failed", {
        status: response.status,
        statusText: response.statusText,
        collection: payload.collection,
        requestId,
        responseBody
      });
    }
  } catch (error) {
    logger?.warn?.("[payload] failed to call revalidate endpoint", {
      collection: payload.collection,
      error: error instanceof Error ? error.message : String(error),
      requestId
    });
  }
};

export const createRevalidateHooks = (collection: string) => {
  const afterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
    const environment =
      extractEnvironment(doc as Record<string, unknown>) ??
      extractEnvironment(previousDoc as Record<string, unknown>) ??
      ENVIRONMENT_FALLBACK ?? null;

    const docId = extractIdentifier(doc as Record<string, unknown>);
    const previousDocId = extractIdentifier(previousDoc as Record<string, unknown>);

    await sendRevalidateRequest(
      {
        collection,
        doc: doc as Record<string, unknown>,
        previousDoc: previousDoc as Record<string, unknown>,
        environment,
        docId,
        previousDocId
      },
      req.payload?.logger
    );

    return doc;
  };

  const afterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
    const environment = extractEnvironment(doc as Record<string, unknown>) ?? ENVIRONMENT_FALLBACK ?? null;
    const previousDocId = extractIdentifier(doc as Record<string, unknown>);

    await sendRevalidateRequest(
      {
        collection,
        previousDoc: doc as Record<string, unknown>,
        environment,
        previousDocId
      },
      req.payload?.logger
    );
  };

  return { afterChange, afterDelete };
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
      const current = (value as Record<string, unknown>).current;
      if (typeof current === "string" && current.trim().length > 0) {
        return current;
      }
    }
  }
  return null;
};
