import { describe, expect, test } from "@jest/globals";

import {
  deriveDeliveryTimelineResolution,
  type CheckoutDeliveryTimeline,
  type DeliveryTimelineMetric,
} from "@/server/cms/delivery-timeline";

const buildMetric = (overrides: Partial<DeliveryTimelineMetric> = {}): DeliveryTimelineMetric => ({
  verificationState: "fresh",
  rawValue: 180,
  percentileBands: { p50: 90, p90: 180 },
  metadata: {
    overall_percentile_bands: { p50: 90, p90: 180 },
  },
  forecast: {
    skus: [
      {
        estimatedClearMinutes: 75,
      },
    ],
  },
  alerts: ["sla_watch"],
  fallbackCopy: "Backlog elevated – concierge is monitoring launch windows.",
  cacheLayer: "computed",
  ...overrides,
});

const buildTimeline = (
  overrides: Partial<CheckoutDeliveryTimeline> = {},
): CheckoutDeliveryTimeline => ({
  id: "delivery",
  headline: "Verified delivery forecast",
  narrative: "Operators reconcile staffing + backlog before publishing commitments.",
  fallbackMinMinutes: 10 * 24 * 60,
  fallbackAverageMinutes: 12 * 24 * 60,
  fallbackMaxMinutes: 14 * 24 * 60,
  fallbackConfidence: "Verified timeline",
  metric: buildMetric(),
  resolved: undefined,
  ...overrides,
});

describe("deriveDeliveryTimelineResolution", () => {
  test("prefers live forecast data when metric is fresh", () => {
    const timeline = buildTimeline();

    const resolved = deriveDeliveryTimelineResolution(timeline);

    expect(resolved.minMinutes).toBe(75);
    expect(resolved.averageMinutes).toBe(90);
    expect(resolved.maxMinutes).toBe(180);
    expect(resolved.p50Minutes).toBe(90);
    expect(resolved.p90Minutes).toBe(180);
    expect(resolved.confidence).toBe("Live forecast");
    expect(resolved.alerts).toContain("sla_watch");
    expect(resolved.fallbackCopy).toContain("Backlog elevated");
    expect(resolved.cacheLayer).toBe("computed");
  });

  test("falls back to CMS defaults when metric is missing", () => {
    const timeline = buildTimeline({
      metric: buildMetric({
        verificationState: "missing",
        rawValue: null,
        percentileBands: null,
        metadata: {},
        forecast: { skus: [] },
        alerts: null,
        cacheLayer: null,
        fallbackCopy: null,
      }),
    });

    const resolved = deriveDeliveryTimelineResolution(timeline);

    expect(resolved.minMinutes).toBe(timeline.fallbackMinMinutes);
    expect(resolved.averageMinutes).toBe(timeline.fallbackAverageMinutes);
    expect(resolved.maxMinutes).toBe(timeline.fallbackMaxMinutes);
    expect(resolved.confidence).toBe("Fallback timeline");
    expect(resolved.alerts).toHaveLength(0);
  });
});
