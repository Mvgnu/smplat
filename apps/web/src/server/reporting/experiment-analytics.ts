import type {
  ExperimentAnalyticsOverview,
  ExperimentConversionMetric,
  ExperimentTrendSeries,
  OnboardingExperimentEvent,
  VariantStatusBreakdown,
} from "@/types/reporting";
import { buildSparklineFromCounts, chartDayFormatter, isoDateKey } from "@/lib/experiment-analytics";

const TREND_DAYS = 10;
const MAX_TREND_SLUGS = 5;
const MAX_VARIANTS = 8;
const MAX_CONVERSION_ROWS = 6;

const ACTIVE_STATUSES = new Set(["running", "active", "launched", "launching", "preview", "seeding"]);
const STALLED_STATUSES = new Set(["paused", "stalled", "hold", "blocked", "ended", "failed"]);

type TrendBucket = { key: string; label: string };

export function buildExperimentAnalyticsOverview(
  events: OnboardingExperimentEvent[],
): ExperimentAnalyticsOverview {
  const cleaned = Array.isArray(events) ? events : [];
  return {
    trendSeries: buildExperimentTrendSeries(cleaned),
    variantBreakdown: buildVariantStatusBreakdown(cleaned),
    conversionMetrics: buildExperimentConversionMetrics(cleaned),
    quickOrderFunnel: null,
  };
}

function buildExperimentTrendSeries(events: OnboardingExperimentEvent[]): ExperimentTrendSeries[] {
  if (!events.length) {
    return [];
  }

  const buckets = createTrendBuckets(TREND_DAYS);
  const indexByKey = new Map<string, number>(buckets.map((bucket, index) => [bucket.key, index]));
  const slugSeries = new Map<string, number[]>();

  for (const event of events) {
    const timestamp = parseTimestamp(event.recordedAt);
    if (!timestamp) {
      continue;
    }
    const key = isoDateKey(timestamp);
    const bucketIndex = indexByKey.get(key);
    if (bucketIndex === undefined) {
      continue;
    }
    const slug = event.slug;
    if (!slug) {
      continue;
    }
    let counts = slugSeries.get(slug);
    if (!counts) {
      counts = Array.from({ length: buckets.length }, () => 0);
      slugSeries.set(slug, counts);
    }
    counts[bucketIndex] += 1;
  }

  return Array.from(slugSeries.entries())
    .map(([slug, counts]) => {
      const totalEvents = counts.reduce((sum, value) => sum + value, 0);
      return {
        slug,
        totalEvents,
        latestCount: counts[counts.length - 1] ?? 0,
        sparklinePoints: buildSparklineFromCounts(counts),
        labels: counts.map((count, index) => ({
          date: buckets[index]?.label ?? "",
          count,
        })),
      };
    })
    .filter((entry) => entry.totalEvents > 0)
    .sort((a, b) => b.totalEvents - a.totalEvents)
    .slice(0, MAX_TREND_SLUGS);
}

function buildVariantStatusBreakdown(events: OnboardingExperimentEvent[]): VariantStatusBreakdown[] {
  if (!events.length) {
    return [];
  }
  const entryMap = new Map<string, VariantStatusBreakdown>();
  for (const event of events) {
    const slug = event.slug;
    const variantKey = event.variantKey;
    if (!slug || !variantKey) {
      continue;
    }
    const normalizedStatus = normalizeStatus(event.status);
    const key = `${slug}::${variantKey}`;
    const entry =
      entryMap.get(key) ??
      {
        slug,
        variantKey,
        variantLabel: event.variantName ?? variantKey,
        active: 0,
        stalled: 0,
      };
    if (isStalledStatus(normalizedStatus)) {
      entry.stalled += 1;
    } else {
      entry.active += 1;
    }
    entryMap.set(key, entry);
  }

  return Array.from(entryMap.values())
    .filter((entry) => entry.active + entry.stalled > 0)
    .sort((a, b) => {
      const totalDelta = b.active + b.stalled - (a.active + a.stalled);
      if (totalDelta !== 0) {
        return totalDelta;
      }
      const slugCompare = a.slug.localeCompare(b.slug);
      if (slugCompare !== 0) {
        return slugCompare;
      }
      return a.variantLabel.localeCompare(b.variantLabel);
    })
    .slice(0, MAX_VARIANTS);
}

type ConversionBucket = {
  orders: Set<string>;
  journeys: Set<string>;
  lastActivity: Date | null;
  orderAmounts: Map<string, { amount: number; currency: string | null }>;
  loyaltyPoints: Map<string, number>;
};

function buildExperimentConversionMetrics(events: OnboardingExperimentEvent[]): ExperimentConversionMetric[] {
  if (!events.length) {
    return [];
  }
  const map = new Map<string, ConversionBucket>();
  for (const event of events) {
    const slug = event.slug;
    if (!slug) {
      continue;
    }
    const bucket =
      map.get(slug) ??
      {
        orders: new Set<string>(),
        journeys: new Set<string>(),
        lastActivity: null,
        orderAmounts: new Map<string, { amount: number; currency: string | null }>(),
        loyaltyPoints: new Map<string, number>(),
      };
    if (event.orderId) {
      bucket.orders.add(event.orderId);
      const hasOrderTotal = typeof event.orderTotal === "number" && Number.isFinite(event.orderTotal);
      if (hasOrderTotal) {
        bucket.orderAmounts.set(event.orderId, {
          amount: event.orderTotal,
          currency: event.orderCurrency ?? null,
        });
      }
      const loyaltyPoints =
        typeof event.loyaltyProjectionPoints === "number" && Number.isFinite(event.loyaltyProjectionPoints)
          ? event.loyaltyProjectionPoints
          : null;
      if (loyaltyPoints !== null) {
        bucket.loyaltyPoints.set(event.orderId, loyaltyPoints);
      }
    }
    if (event.journeyId) {
      bucket.journeys.add(event.journeyId);
    }
    const timestamp = parseTimestamp(event.recordedAt);
    if (timestamp && (!bucket.lastActivity || timestamp > bucket.lastActivity)) {
      bucket.lastActivity = timestamp;
    }
    map.set(slug, bucket);
  }

  return Array.from(map.entries())
    .map(([slug, bucket]) => {
      const totalsByCurrency = new Map<string | null, number>();
      for (const entry of bucket.orderAmounts.values()) {
        const key = entry.currency ?? null;
        const running = totalsByCurrency.get(key) ?? 0;
        totalsByCurrency.set(key, running + entry.amount);
      }
      let selectedCurrency: string | null = null;
      let selectedTotal = 0;
      for (const [currency, total] of totalsByCurrency.entries()) {
        if (total > selectedTotal) {
          selectedCurrency = currency;
          selectedTotal = total;
        }
      }

      const loyaltyPoints = Array.from(bucket.loyaltyPoints.values()).reduce(
        (sum, value) => sum + value,
        0,
      );

      return {
        slug,
        orderCount: bucket.orders.size,
        journeyCount: bucket.journeys.size,
        orderTotal: Number.isFinite(selectedTotal) ? selectedTotal : 0,
        orderCurrency: selectedCurrency,
        loyaltyPoints,
        lastActivity: bucket.lastActivity ? bucket.lastActivity.toISOString() : null,
      };
    })
    .filter((entry) => entry.orderCount > 0 || entry.journeyCount > 0)
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) {
        return b.orderCount - a.orderCount;
      }
      return b.journeyCount - a.journeyCount;
    })
    .slice(0, MAX_CONVERSION_ROWS);
}

function createTrendBuckets(days: number): TrendBucket[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return {
      key: isoDateKey(date),
      label: chartDayFormatter.format(date),
    };
  });
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStatus(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase();
}

function isStalledStatus(status: string | null): boolean {
  if (!status) {
    return false;
  }
  if (STALLED_STATUSES.has(status)) {
    return true;
  }
  if (ACTIVE_STATUSES.has(status)) {
    return false;
  }
  return status.includes("stall") || status.includes("pause") || status.includes("hold");
}
