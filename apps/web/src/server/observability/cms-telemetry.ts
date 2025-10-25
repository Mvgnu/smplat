import "server-only";

type MetricKey =
  | "preview_success"
  | "preview_invalid_secret"
  | "preview_missing_secret"
  | "preview_invalid_redirect"
  | "revalidate_success"
  | "revalidate_skipped"
  | "revalidate_error";

const counters = new Map<MetricKey, number>();

const increment = (key: MetricKey) => {
  const current = counters.get(key) ?? 0;
  counters.set(key, current + 1);
};

export const recordPreviewMetric = (key: "success" | "invalid_secret" | "missing_secret" | "invalid_redirect") => {
  // meta: metric=preview
  increment(`preview_${key}` as MetricKey);
};

export const recordRevalidateMetric = (key: "success" | "skipped" | "error") => {
  // meta: metric=revalidate
  increment(`revalidate_${key}` as MetricKey);
};

export const getCmsMetricSnapshot = () => {
  return Object.fromEntries(counters.entries());
};
