import "server-only";

import type {
  GuardrailAttachmentMetadata,
  GuardrailFollowUpAction,
  GuardrailFollowUpEntry,
  GuardrailFollowUpFeed,
  GuardrailFollowUpStatus,
} from "@/types/reporting";
import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKey = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

const defaultHeaders: HeadersInit = apiKey
  ? {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    }
  : {
      "Content-Type": "application/json",
    };

const fallbackFeed: GuardrailFollowUpFeed = {
  entries: [],
  nextCursor: null,
  status: null,
  providerTelemetry: null,
};

const stringFormatter = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const sanitizeAction = (value: unknown): GuardrailFollowUpAction | null => {
  if (value === "pause" || value === "resume" || value === "escalate") {
    return value;
  }
  return null;
};

const sanitizePlatformContext = (
  value: unknown,
): GuardrailFollowUpEntry["platformContext"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = stringFormatter(record.id);
  const label = stringFormatter(record.label);
  if (!id || !label) {
    return null;
  }
  return {
    id,
    label,
    handle: stringFormatter(record.handle),
    platformType: stringFormatter(record.platformType),
  };
};

const sanitizeAttachments = (value: unknown): GuardrailAttachmentMetadata[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const attachments: GuardrailAttachmentMetadata[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = stringFormatter(record.id);
    const assetUrl = stringFormatter(record.assetUrl);
    const fileName = stringFormatter(record.fileName) ?? id;
    if (!id || !assetUrl || !fileName) {
      continue;
    }
    attachments.push({
      id,
      assetUrl,
      fileName,
      storageKey: stringFormatter(record.storageKey) ?? id,
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : null,
      contentType: stringFormatter(record.contentType),
      uploadedAt: stringFormatter(record.uploadedAt),
    });
  }
  return attachments.length ? attachments : null;
};

const sanitizeFollowUp = (value: unknown): GuardrailFollowUpEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = stringFormatter(record.id);
  const providerId = stringFormatter(record.providerId);
  const action = sanitizeAction(record.action);
  const createdAt = stringFormatter(record.createdAt);
  if (!id || !providerId || !action || !createdAt) {
    return null;
  }
  return {
    id,
    providerId,
    providerName: stringFormatter(record.providerName),
    action,
    notes: stringFormatter(record.notes),
    platformContext: sanitizePlatformContext(record.platformContext),
    attachments: sanitizeAttachments(record.attachments),
    createdAt,
    conversionCursor: stringFormatter(record.conversionCursor),
    conversionHref: stringFormatter(record.conversionHref),
  };
};

const sanitizeStatus = (value: unknown): GuardrailFollowUpStatus | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const providerId = stringFormatter(record.providerId);
  const updatedAt = stringFormatter(record.updatedAt);
  if (!providerId || !updatedAt) {
    return null;
  }
  const lastAction = stringFormatter(record.lastAction);
  return {
    providerId,
    providerName: stringFormatter(record.providerName),
    isPaused: Boolean(record.isPaused),
    lastAction: lastAction as GuardrailFollowUpStatus["lastAction"],
    updatedAt,
    lastFollowUpId: stringFormatter(record.lastFollowUpId),
  };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const sanitizeProviderTelemetry = (value: unknown): ProviderAutomationTelemetry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.totalOrders)) {
    return null;
  }
  return record as ProviderAutomationTelemetry;
};

const sanitizeFeed = (payload: unknown): GuardrailFollowUpFeed => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallbackFeed;
  }
  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries
        .map((entry) => sanitizeFollowUp(entry))
        .filter((entry): entry is GuardrailFollowUpEntry => entry !== null)
    : [];
  const nextCursor = stringFormatter(record.nextCursor);
  const status = sanitizeStatus(record.status);
  const providerTelemetry = sanitizeProviderTelemetry(record.providerTelemetry);
  return {
    entries,
    nextCursor,
    status,
    providerTelemetry,
  };
};

export type GuardrailFollowUpSubmission = {
  entry: GuardrailFollowUpEntry;
  status: GuardrailFollowUpStatus | null;
  providerTelemetry: ProviderAutomationTelemetry | null;
};

export type GuardrailFollowUpInput = {
  providerId: string;
  providerName?: string | null;
  action: GuardrailFollowUpAction;
  notes?: string | null;
  platformContext?: {
    id: string;
    label: string;
    handle?: string | null;
    platformType?: string | null;
  } | null;
  conversionCursor?: string | null;
  conversionHref?: string | null;
  attachments?: GuardrailAttachmentMetadata[] | null;
};

const sanitizeSubmission = (payload: unknown): GuardrailFollowUpSubmission | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const entryPayload = "entry" in record ? (record.entry as unknown) : payload;
  const entry = sanitizeFollowUp(entryPayload);
  if (!entry) {
    return null;
  }
  const status = sanitizeStatus(record.status);
  const providerTelemetry = sanitizeProviderTelemetry(record.providerTelemetry);
  return {
    entry,
    status,
    providerTelemetry,
  };
};

export async function recordGuardrailFollowUp(
  input: GuardrailFollowUpInput,
): Promise<GuardrailFollowUpSubmission> {
  if (!apiKey) {
    throw new Error("CHECKOUT_API_KEY is required to log guardrail follow-ups.");
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/reporting/guardrails/followups`, {
    method: "POST",
    headers: defaultHeaders,
    cache: "no-store",
    body: JSON.stringify({
      providerId: input.providerId,
      providerName: input.providerName ?? null,
      action: input.action,
      notes: input.notes ?? null,
      platformContext: input.platformContext ?? null,
      conversionCursor: input.conversionCursor ?? null,
      conversionHref: input.conversionHref ?? null,
      attachments: input.attachments ?? null,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to record guardrail follow-up.");
  }

  const payload = sanitizeSubmission(await response.json());
  if (!payload) {
    throw new Error("Follow-up response was missing required fields.");
  }
  return payload;
}

export type FetchGuardrailFollowUpOptions = {
  providerId: string;
  limit?: number;
  cursor?: string | null;
};

export async function fetchGuardrailFollowUps(
  options: FetchGuardrailFollowUpOptions,
): Promise<GuardrailFollowUpFeed> {
  if (!apiKey || !options.providerId) {
    return fallbackFeed;
  }

  const params = new URLSearchParams();
  params.set("providerId", options.providerId);
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", Math.min(options.limit, 100).toString());
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const url = `${apiBaseUrl}/api/v1/reporting/guardrails/followups?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to fetch guardrail follow-ups", {
        status: response.status,
        statusText: response.statusText,
      });
      return fallbackFeed;
    }

    const payload = await response.json();
    return sanitizeFeed(payload);
  } catch (error) {
    console.error("Unable to fetch guardrail follow-up feed", error);
    return fallbackFeed;
  }
}
