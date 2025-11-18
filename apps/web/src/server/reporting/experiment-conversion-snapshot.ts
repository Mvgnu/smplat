import "server-only";

import type {
  ExperimentConversionMetric,
  ExperimentConversionSnapshotResponse,
} from "@/types/reporting";

// meta: module: reporting-experiment-conversions

type RawConversionMetric = Partial<ExperimentConversionMetric> & {
  lastActivity?: string | Date | null;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

const fallbackResponse: ExperimentConversionSnapshotResponse = {
  metrics: [],
  nextCursor: null,
  cursor: null,
};

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toNumberValue = (value: unknown): number | null => {
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

const toIntegerValue = (value: unknown): number => {
  const parsed = toNumberValue(value);
  if (parsed === null) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
};

const toIsoDateValue = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const stringValue = toStringValue(value);
  if (!stringValue) {
    return null;
  }
  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

function sanitizeMetric(entry: RawConversionMetric | null | undefined): ExperimentConversionMetric | null {
  if (!entry) {
    return null;
  }
  const slug = toStringValue(entry.slug);
  if (!slug) {
    return null;
  }
  const orderTotal = toNumberValue(entry.orderTotal) ?? 0;
  return {
    slug,
    orderCount: toIntegerValue(entry.orderCount),
    journeyCount: toIntegerValue(entry.journeyCount),
    orderTotal: orderTotal >= 0 ? orderTotal : 0,
    orderCurrency: toStringValue(entry.orderCurrency),
    loyaltyPoints: toIntegerValue(entry.loyaltyPoints),
    lastActivity: toIsoDateValue(entry.lastActivity),
  };
}

function sanitizeResponse(payload: unknown): ExperimentConversionSnapshotResponse {
  if (!payload || typeof payload !== "object") {
    return fallbackResponse;
  }
  const record = payload as Record<string, unknown>;
  const metrics = Array.isArray(record.metrics) ? record.metrics : [];
  const cleaned = metrics
    .map((metric) => sanitizeMetric(metric as RawConversionMetric))
    .filter((metric): metric is ExperimentConversionMetric => metric !== null);
  const nextCursor = toStringValue(record.nextCursor);
  const cursor = toStringValue(record.cursor);
  return { metrics: cleaned, nextCursor, cursor };
}

export type FetchExperimentConversionSnapshotOptions = {
  limit?: number;
  cursor?: string | null;
};

export async function fetchExperimentConversionSnapshot(
  options: FetchExperimentConversionSnapshotOptions = {},
): Promise<ExperimentConversionSnapshotResponse> {
  if (!apiKeyHeader) {
    return fallbackResponse;
  }

  const params = new URLSearchParams();
  if (options.limit && options.limit > 0) {
    params.set("limit", String(Math.trunc(options.limit)));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const baseUrl = `${apiBaseUrl}/api/v1/reporting/onboarding/experiment-conversions`;
  const query = params.toString();
  const targetUrl = query ? `${baseUrl}?${query}` : baseUrl;

  try {
    const response = await fetch(targetUrl, {
      headers: defaultHeaders,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Experiment conversion snapshot request failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return fallbackResponse;
    }
    const payload = await response.json();
    return sanitizeResponse(payload);
  } catch (error) {
    console.error("Unable to fetch experiment conversion snapshot", error);
    return fallbackResponse;
  }
}
