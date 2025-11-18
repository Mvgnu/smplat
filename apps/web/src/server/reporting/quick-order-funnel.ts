import "server-only";

import { readQuickOrderEvents } from "@/server/telemetry/quick-order-storage";
import type {
  QuickOrderAbortTelemetryEvent,
  QuickOrderCompleteTelemetryEvent,
  QuickOrderFunnelMetrics,
  QuickOrderStartTelemetryEvent,
} from "@/types/reporting";

const LOOKBACK_DAYS = 14;
const DAILY_SERIES_DAYS = 7;

export async function fetchQuickOrderFunnelMetrics(): Promise<QuickOrderFunnelMetrics | null> {
  const events = await readQuickOrderEvents();
  if (!events.length) {
    return null;
  }
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const relevant = events.filter((event) => {
    const timestamp = Date.parse(event.recordedAt ?? "");
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  if (!relevant.length) {
    return null;
  }
  let startCount = 0;
  let abortCount = 0;
  let completeCount = 0;
  const abortReasons = new Map<string, number>();
  let lastEventAt: string | null = null;
  const dailySeries = new Map<string, { starts: number; completes: number }>();
  const dailyCutoff = Date.now() - DAILY_SERIES_DAYS * 24 * 60 * 60 * 1000;

  for (const event of relevant) {
    const timestamp = Date.parse(event.recordedAt ?? "");
    if (Number.isFinite(timestamp) && (!lastEventAt || timestamp > Date.parse(lastEventAt))) {
      lastEventAt = new Date(timestamp).toISOString();
    }
    if (event.name === "quick_order.start") {
      startCount += 1;
      bucketDailySeries(dailySeries, timestamp, "start", dailyCutoff);
    } else if (event.name === "quick_order.abort") {
      abortCount += 1;
      const reason = normalizeAbortReason(event);
      abortReasons.set(reason, (abortReasons.get(reason) ?? 0) + 1);
    } else if (event.name === "quick_order.complete") {
      completeCount += 1;
      bucketDailySeries(dailySeries, timestamp, "complete", dailyCutoff);
    }
  }

  const completionRate = startCount === 0 ? 0 : Math.round((completeCount / startCount) * 100);
  const abortReasonBreakdown = Array.from(abortReasons.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
  const daily = Array.from(dailySeries.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({
      date,
      starts: values.starts,
      completes: values.completes,
    }));

  return {
    startCount,
    abortCount,
    completeCount,
    completionRate,
    abortReasons: abortReasonBreakdown,
    lastEventAt,
    dailySeries: daily,
  };
}

function normalizeAbortReason(event: QuickOrderAbortTelemetryEvent): string {
  const reason = event.reason || event.metadata?.reason;
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }
  const stage = event.metadata?.stage;
  if (typeof stage === "string" && stage.trim().length > 0) {
    return `stage_${stage}`;
  }
  return "unknown";
}

type QuickOrderEventNames = "start" | "complete";

function bucketDailySeries(
  series: Map<string, { starts: number; completes: number }>,
  timestamp: number,
  event: QuickOrderEventNames,
  cutoff: number,
): void {
  if (!Number.isFinite(timestamp) || timestamp < cutoff) {
    return;
  }
  const dateKey = new Date(timestamp).toISOString().slice(0, 10);
  const bucket = series.get(dateKey) ?? { starts: 0, completes: 0 };
  if (event === "start") {
    bucket.starts += 1;
  } else {
    bucket.completes += 1;
  }
  series.set(dateKey, bucket);
}
