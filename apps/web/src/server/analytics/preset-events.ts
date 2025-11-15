import "server-only";

// meta: module: analytics-preset-events

export type PresetEventTotals = {
  preset_cta_apply: number;
  preset_configurator_apply: number;
  preset_configurator_clear: number;
};

export type PresetEventTrendStats = {
  applyAvg7?: number;
  applyAvg30?: number;
  netAvg7?: number;
  clearRate7?: number;
  totalAvg30?: number;
  totalMin30?: number;
  totalMax30?: number;
};

export type PresetEventTimelineEntry = {
  date: string;
  counts: {
    presetCtaApply: number;
    presetConfiguratorApply: number;
    presetConfiguratorClear: number;
  };
  totals: {
    applies: number;
    clears: number;
    total: number;
    net: number;
    clearRate: number;
  };
  trend?: PresetEventTrendStats | null;
};

export type PresetBreakdownEntry = {
  presetId: string;
  presetLabel?: string | null;
  cta: number;
  configurator: number;
  clears: number;
  applies: number;
  net: number;
  clearRate: number;
  isRisky?: boolean;
  riskReason?: string | null;
  windows?: Record<
    string,
    {
      applies: number;
      clears: number;
      net: number;
      clearRate: number;
    }
  >;
};

export type PresetAnalyticsBreakdowns = {
  presets: PresetBreakdownEntry[];
  sources: Array<
    {
      source: string;
      cta: number;
      configurator: number;
      clears: number;
      applies: number;
      net: number;
      clearRate: number;
      windows?: Record<
        string,
        {
          applies: number;
          clears: number;
          net: number;
          clearRate: number;
        }
      >;
    }
  >;
  riskyPresets: PresetBreakdownEntry[];
};

export type PresetEventAnalytics = {
  window: {
    days: number;
    start: string;
  };
  totals: PresetEventTotals;
  sources: Array<{ eventType: string; source: string; count: number }>;
  timeline: PresetEventTimelineEntry[];
  breakdowns?: PresetAnalyticsBreakdowns | null;
  alerts: Array<{
    code: string;
    severity: "info" | "warn" | "error";
    message: string;
    metrics?: Record<string, unknown>;
  }>;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

const fallbackAnalytics: PresetEventAnalytics = {
  window: {
    days: 30,
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  totals: {
    preset_cta_apply: 0,
    preset_configurator_apply: 0,
    preset_configurator_clear: 0,
  },
  sources: [],
  timeline: [],
  breakdowns: { presets: [], sources: [], riskyPresets: [] },
  alerts: [],
};

type FetchPresetAnalyticsOptions = {
  windowDays?: number;
};

export async function fetchPresetEventAnalytics(
  options: FetchPresetAnalyticsOptions = {},
): Promise<PresetEventAnalytics> {
  if (!apiKeyHeader) {
    return fallbackAnalytics;
  }

  const params = new URLSearchParams();
  if (options.windowDays && Number.isFinite(options.windowDays)) {
    params.set("window_days", String(options.windowDays));
  }

  const query = params.toString();
  const targetUrl = query
    ? `${apiBaseUrl}/api/v1/analytics/preset-events?${query}`
    : `${apiBaseUrl}/api/v1/analytics/preset-events`;

  try {
    const response = await fetch(targetUrl, {
      headers: defaultHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to load preset event analytics", {
        status: response.status,
        statusText: response.statusText,
      });
      return fallbackAnalytics;
    }

    const payload = (await response.json()) as PresetEventAnalytics;
    return payload;
  } catch (error) {
    console.error("Preset event analytics request failed", error);
    return fallbackAnalytics;
  }
}
