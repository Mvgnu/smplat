import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from "payload/types";

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const REVALIDATE_ENDPOINT = process.env.PAYLOAD_REVALIDATE_ENDPOINT || `${WEB_URL}/api/revalidate`;
const REVALIDATE_SECRET = process.env.PAYLOAD_REVALIDATE_SECRET;
const ENVIRONMENT_FALLBACK = process.env.CMS_ENV;

type Logger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type RevalidatePayload = {
  collection: string;
  doc?: Record<string, unknown> | null;
  previousDoc?: Record<string, unknown> | null;
  environment?: string | null;
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
    return;
  }

  try {
    const response = await fetch(REVALIDATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-payload-signature": REVALIDATE_SECRET
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      logger?.warn?.("[payload] revalidate request failed", {
        status: response.status,
        statusText: response.statusText,
        collection: payload.collection
      });
    }
  } catch (error) {
    logger?.warn?.("[payload] failed to call revalidate endpoint", {
      collection: payload.collection,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const createRevalidateHooks = (collection: string) => {
  const afterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
    const environment =
      extractEnvironment(doc as Record<string, unknown>) ??
      extractEnvironment(previousDoc as Record<string, unknown>) ??
      ENVIRONMENT_FALLBACK ?? null;

    await sendRevalidateRequest(
      {
        collection,
        doc: doc as Record<string, unknown>,
        previousDoc: previousDoc as Record<string, unknown>,
        environment
      },
      req.payload?.logger
    );

    return doc;
  };

  const afterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
    const environment = extractEnvironment(doc as Record<string, unknown>) ?? ENVIRONMENT_FALLBACK ?? null;

    await sendRevalidateRequest(
      {
        collection,
        previousDoc: doc as Record<string, unknown>,
        environment
      },
      req.payload?.logger
    );
  };

  return { afterChange, afterDelete };
};
