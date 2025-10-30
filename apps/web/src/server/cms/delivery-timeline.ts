export type TimelineMetricState = "fresh" | "stale" | "missing" | "unsupported" | "preview";

type TimelineMetricForecastWindow = {
  estimatedClearMinutes: number | null | undefined;
};

type TimelineMetricForecast = {
  skus: TimelineMetricForecastWindow[];
};

export type DeliveryTimelineMetric = {
  verificationState: TimelineMetricState;
  rawValue?: number | null;
  percentileBands?: Record<string, number | null> | null;
  metadata?: Record<string, unknown> | null;
  forecast?: TimelineMetricForecast | null;
  alerts?: string[] | null;
  fallbackCopy?: string | null;
  cacheLayer?: string | null;
};

export type CheckoutDeliveryTimelineResolved = {
  minMinutes?: number | null;
  p50Minutes?: number | null;
  p90Minutes?: number | null;
  maxMinutes?: number | null;
  averageMinutes?: number | null;
  confidence?: string | null;
  alerts: string[];
  fallbackCopy?: string | null;
  cacheLayer?: string | null;
};

export type CheckoutDeliveryTimeline = {
  id: string;
  headline: string;
  narrative?: string;
  fallbackMinMinutes?: number | null;
  fallbackMaxMinutes?: number | null;
  fallbackAverageMinutes?: number | null;
  fallbackConfidence?: string | null;
  metric?: DeliveryTimelineMetric;
  resolved?: CheckoutDeliveryTimelineResolved;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractPercentile = (
  metric: DeliveryTimelineMetric,
  bands: Record<string, unknown> | null,
  key: string,
): number | null => {
  if (metric.percentileBands && typeof metric.percentileBands[key] === "number") {
    const value = metric.percentileBands[key];
    return typeof value === "number" ? value : null;
  }
  if (bands && typeof bands[key] !== "undefined") {
    return toNumberOrNull(bands[key]);
  }
  return null;
};

export const deriveDeliveryTimelineResolution = (
  timeline: CheckoutDeliveryTimeline,
): CheckoutDeliveryTimelineResolved => {
  const fallback: CheckoutDeliveryTimelineResolved = {
    minMinutes: timeline.fallbackMinMinutes ?? null,
    p50Minutes: timeline.fallbackAverageMinutes ?? timeline.fallbackMinMinutes ?? null,
    p90Minutes: timeline.fallbackMaxMinutes ?? null,
    maxMinutes: timeline.fallbackMaxMinutes ?? null,
    averageMinutes: timeline.fallbackAverageMinutes ?? null,
    confidence: timeline.fallbackConfidence ?? null,
    alerts: [],
    fallbackCopy: timeline.narrative ?? undefined,
    cacheLayer: null,
  };

  const metric = timeline.metric;
  if (!metric) {
    return fallback;
  }

  let metadataBands: Record<string, unknown> | null = null;
  if (metric.metadata && isRecord(metric.metadata)) {
    const candidate =
      (metric.metadata as Record<string, unknown>)["overall_percentile_bands"] ??
      (metric.metadata as Record<string, unknown>)["overallPercentileBands"];
    metadataBands = isRecord(candidate) ? (candidate as Record<string, unknown>) : null;
  }

  const p50 = extractPercentile(metric, metadataBands, "p50");
  const p90 = extractPercentile(metric, metadataBands, "p90");

  const forecastWindows = metric.forecast?.skus ?? [];
  const forecastMinutes = forecastWindows
    .map((window) => toNumberOrNull(window.estimatedClearMinutes ?? null))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const minFromForecast = forecastMinutes.length > 0 ? Math.min(...forecastMinutes) : null;

  const maxMinutes = typeof metric.rawValue === "number" ? metric.rawValue : p90 ?? fallback.maxMinutes;
  const averageMinutes = typeof p50 === "number" ? p50 : fallback.averageMinutes;
  const minMinutes = minFromForecast ?? fallback.minMinutes ?? (typeof p50 === "number" ? p50 : null);

  let confidence = fallback.confidence;
  switch (metric.verificationState) {
    case "fresh":
      confidence = "Live forecast";
      break;
    case "stale":
      confidence = "Stale forecast";
      break;
    case "preview":
      confidence = "Preview timeline";
      break;
    case "unsupported":
    case "missing":
      confidence = "Fallback timeline";
      break;
    default:
      confidence = confidence ?? "Forecast";
      break;
  }

  const alerts = metric.alerts ?? [];
  const fallbackCopy = metric.fallbackCopy ?? fallback.fallbackCopy;
  const cacheLayer = metric.cacheLayer ?? fallback.cacheLayer;

  return {
    minMinutes,
    p50Minutes: p50 ?? fallback.p50Minutes,
    p90Minutes: p90 ?? fallback.p90Minutes,
    maxMinutes,
    averageMinutes,
    confidence,
    alerts: [...alerts],
    fallbackCopy: fallbackCopy ?? undefined,
    cacheLayer,
  } satisfies CheckoutDeliveryTimelineResolved;
};
