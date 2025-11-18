import "server-only";

import type { OnboardingExperimentEvent, OnboardingExperimentExportResponse } from "@/types/reporting";

// meta: module: reporting-onboarding-experiments

type RawExperimentEvent = Partial<OnboardingExperimentEvent> & {
  recordedAt?: string | Date | null;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

const fallbackResponse: OnboardingExperimentExportResponse = {
  events: [],
  nextCursor: null,
};

const numberFormatter = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringFormatter = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const optionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const booleanFormatter = (value: unknown): boolean | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
};

const recordedAtFormatter = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const asString = stringFormatter(value);
  if (!asString) {
    return new Date().toISOString();
  }
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

function sanitizeEvent(entry: RawExperimentEvent | null | undefined): OnboardingExperimentEvent | null {
  if (!entry) {
    return null;
  }

  const eventId = stringFormatter(entry.eventId);
  const journeyId = stringFormatter(entry.journeyId);
  const orderId = stringFormatter(entry.orderId);
  const slug = stringFormatter(entry.slug);
  const variantKey = stringFormatter(entry.variantKey);

  if (!eventId || !journeyId || !orderId || !slug || !variantKey) {
    return null;
  }

  return {
    eventId,
    journeyId,
    orderId,
    orderNumber: stringFormatter(entry.orderNumber),
    orderTotal: optionalNumber(entry.orderTotal) ?? null,
    orderCurrency: stringFormatter(entry.orderCurrency),
    loyaltyProjectionPoints: optionalNumber(entry.loyaltyProjectionPoints),
    slug,
    variantKey,
    variantName: stringFormatter(entry.variantName),
    isControl: booleanFormatter(entry.isControl),
    assignmentStrategy: stringFormatter(entry.assignmentStrategy),
    status: stringFormatter(entry.status),
    featureFlagKey: stringFormatter(entry.featureFlagKey),
    recordedAt: recordedAtFormatter(entry.recordedAt ?? null),
  };
}

function sanitizeResponse(payload: unknown): OnboardingExperimentExportResponse {
  if (!payload || typeof payload !== "object") {
    return fallbackResponse;
  }

  const record = payload as Record<string, unknown>;
  const rawEvents = Array.isArray(record.events) ? record.events : [];

  const events = rawEvents
    .map((entry) => sanitizeEvent(entry as RawExperimentEvent))
    .filter((entry): entry is OnboardingExperimentEvent => entry !== null);

  const nextCursor = record.nextCursor;
  return {
    events,
    nextCursor: typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : null,
  };
}

export type FetchOnboardingExperimentOptions = {
  limit?: number;
  cursor?: string | null;
};

export async function fetchOnboardingExperimentEvents(
  options: FetchOnboardingExperimentOptions = {},
): Promise<OnboardingExperimentExportResponse> {
  if (!apiKeyHeader) {
    return fallbackResponse;
  }

  const params = new URLSearchParams();
  const limit = numberFormatter(options.limit, 0);
  if (limit > 0) {
    params.set("limit", String(limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const query = params.toString();
  const baseUrl = `${apiBaseUrl}/api/v1/reporting/onboarding/experiment-events`;
  const targetUrl = query ? `${baseUrl}?${query}` : baseUrl;

  try {
    const response = await fetch(targetUrl, {
      headers: defaultHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Onboarding experiment export request failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return fallbackResponse;
    }

    const payload = await response.json();
    return sanitizeResponse(payload);
  } catch (error) {
    console.error("Unable to fetch onboarding experiment export", error);
    return fallbackResponse;
  }
}
