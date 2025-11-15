import "server-only";

// meta: module: reporting-blueprint-metrics

type BlueprintMetricWindow = {
  days: number;
  start: string;
};

type BlueprintMetricOrders = {
  total: number;
  items: number;
  itemRevenue: number;
};

type BlueprintOptionMetric = {
  groupId?: string | null;
  groupName?: string | null;
  optionId?: string | null;
  label?: string | null;
  selections: number;
  priceDeltaTotal: number;
};

type BlueprintAddOnMetric = {
  addOnId?: string | null;
  label?: string | null;
  pricingMode?: string | null;
  providerName?: string | null;
  selections: number;
  priceDeltaTotal: number;
};

type BlueprintProviderMetric = {
  providerId?: string | null;
  providerName?: string | null;
  serviceId?: string | null;
  serviceAction?: string | null;
  engagements: number;
  amountTotal: number;
};

type BlueprintPresetMetric = {
  presetId: string;
  label?: string | null;
  selections: number;
};

type PresetProviderEngagementEntry = {
  presetId: string;
  presetLabel?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  serviceId?: string | null;
  serviceAction?: string | null;
  currency?: string | null;
  engagements: number;
  amountTotal: number;
  engagementShare: number;
};

type PresetProviderEngagementWindow = {
  days: number;
  start: string;
  entries: PresetProviderEngagementEntry[];
};

type PresetProviderEngagements = {
  generatedAt: string;
  windows: Record<string, PresetProviderEngagementWindow>;
};

type ProviderLoadAlertLinks = {
  merchandising?: string | null;
  fulfillment?: string | null;
  orders?: string | null;
};

export type ProviderLoadAlert = {
  providerId: string;
  providerName?: string | null;
  presetId: string;
  presetLabel?: string | null;
  serviceId?: string | null;
  serviceAction?: string | null;
  currency?: string | null;
  shortWindowDays: number;
  longWindowDays: number;
  shortShare: number;
  longShare: number;
  shareDelta: number;
  shortEngagements: number;
  longEngagements: number;
  shortAmountTotal: number;
  longAmountTotal: number;
  links?: ProviderLoadAlertLinks;
};

export type BlueprintMetrics = {
  window: BlueprintMetricWindow;
  orders: BlueprintMetricOrders;
  options: BlueprintOptionMetric[];
  addOns: BlueprintAddOnMetric[];
  providerEngagements: BlueprintProviderMetric[];
  presets: BlueprintPresetMetric[];
  presetProviderEngagements: PresetProviderEngagements;
  providerLoadAlerts: ProviderLoadAlert[];
};

type BlueprintMetricsApi = Partial<BlueprintMetrics>;

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

const fallbackBlueprintMetrics: BlueprintMetrics = {
  window: {
    days: 30,
    start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
  },
  orders: {
    total: 0,
    items: 0,
    itemRevenue: 0,
  },
  options: [],
  addOns: [],
  providerEngagements: [],
  presets: [],
  presetProviderEngagements: {
    generatedAt: new Date().toISOString(),
    windows: {
      "7": {
        days: 7,
        start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
        entries: [],
      },
      "30": {
        days: 30,
        start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        entries: [],
      },
      "90": {
        days: 90,
        start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(),
        entries: [],
      },
    },
  },
  providerLoadAlerts: [],
};

const numberFormatter = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringFormatter = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function sanitizeOptions(payload: unknown): BlueprintOptionMetric[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      return {
        groupId: stringFormatter(value.groupId),
        groupName: stringFormatter(value.groupName),
        optionId: stringFormatter(value.optionId),
        label: stringFormatter(value.label),
        selections: numberFormatter(value.selections),
        priceDeltaTotal: numberFormatter(value.priceDeltaTotal),
      };
    })
    .filter((item): item is BlueprintOptionMetric => item !== null);
}

function sanitizeAddOns(payload: unknown): BlueprintAddOnMetric[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      return {
        addOnId: stringFormatter(value.addOnId),
        label: stringFormatter(value.label),
        pricingMode: stringFormatter(value.pricingMode),
        providerName: stringFormatter(value.providerName),
        selections: numberFormatter(value.selections),
        priceDeltaTotal: numberFormatter(value.priceDeltaTotal),
      };
    })
    .filter((item): item is BlueprintAddOnMetric => item !== null);
}

function sanitizeProviders(payload: unknown): BlueprintProviderMetric[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      return {
        providerId: stringFormatter(value.providerId),
        providerName: stringFormatter(value.providerName),
        serviceId: stringFormatter(value.serviceId),
        serviceAction: stringFormatter(value.serviceAction),
        engagements: numberFormatter(value.engagements),
        amountTotal: numberFormatter(value.amountTotal),
      };
    })
    .filter((item): item is BlueprintProviderMetric => item !== null);
}

function sanitizePresets(payload: unknown): BlueprintPresetMetric[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      const presetId = stringFormatter(value.presetId) ?? `preset-${index}`;
      return {
        presetId,
        label: stringFormatter(value.label),
        selections: numberFormatter(value.selections),
      };
    })
    .filter((item): item is BlueprintPresetMetric => item !== null);
}

function sanitizePresetProviderEntries(payload: unknown): PresetProviderEngagementEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      const presetId = stringFormatter(value.presetId) ?? `preset-provider-${index}`;
      return {
        presetId,
        presetLabel: stringFormatter(value.presetLabel),
        providerId: stringFormatter(value.providerId),
        providerName: stringFormatter(value.providerName),
        serviceId: stringFormatter(value.serviceId),
        serviceAction: stringFormatter(value.serviceAction),
        currency: stringFormatter(value.currency),
        engagements: numberFormatter(value.engagements),
        amountTotal: numberFormatter(value.amountTotal),
        engagementShare: Math.max(0, Math.min(1, Number(value.engagementShare) || 0)),
      };
    })
    .filter((entry): entry is PresetProviderEngagementEntry => entry !== null);
}

function sanitizePresetProviderEngagements(payload: unknown): PresetProviderEngagements {
  if (!payload || typeof payload !== "object") {
    return fallbackBlueprintMetrics.presetProviderEngagements;
  }

  const source = payload as Record<string, unknown>;
  const windowsPayload = source.windows;
  const windows: Record<string, PresetProviderEngagementWindow> = {};

  if (windowsPayload && typeof windowsPayload === "object") {
    for (const [key, value] of Object.entries(windowsPayload as Record<string, unknown>)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const windowValue = value as Record<string, unknown>;
      windows[key] = {
        days: numberFormatter(windowValue.days, fallbackBlueprintMetrics.window.days),
        start:
          stringFormatter(windowValue.start) ??
          fallbackBlueprintMetrics.presetProviderEngagements.windows["30"].start,
        entries: sanitizePresetProviderEntries(windowValue.entries),
      };
    }
  }

  return {
    generatedAt:
      stringFormatter(source.generatedAt) ??
      fallbackBlueprintMetrics.presetProviderEngagements.generatedAt,
    windows: Object.keys(windows).length > 0 ? windows : fallbackBlueprintMetrics.presetProviderEngagements.windows,
  };
}

function sanitizeProviderLoadAlerts(payload: unknown): ProviderLoadAlert[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value = entry as Record<string, unknown>;
      const presetId = stringFormatter(value.presetId);
      const providerId = stringFormatter(value.providerId);
      if (!presetId || !providerId) {
        return null;
      }
      return {
        providerId,
        providerName: stringFormatter(value.providerName),
        presetId,
        presetLabel: stringFormatter(value.presetLabel),
        serviceId: stringFormatter(value.serviceId),
        serviceAction: stringFormatter(value.serviceAction),
        currency: stringFormatter(value.currency),
        shortWindowDays: numberFormatter(value.shortWindowDays, 7),
        longWindowDays: numberFormatter(value.longWindowDays, 90),
        shortShare: numberFormatter(value.shortShare),
        longShare: numberFormatter(value.longShare),
        shareDelta: numberFormatter(value.shareDelta),
        shortEngagements: numberFormatter(value.shortEngagements),
        longEngagements: numberFormatter(value.longEngagements),
        shortAmountTotal: numberFormatter(value.shortAmountTotal),
        longAmountTotal: numberFormatter(value.longAmountTotal),
        links: sanitizeAlertLinks(value.links),
      };
    })
    .filter((entry): entry is ProviderLoadAlert => entry !== null);
}

function sanitizeAlertLinks(payload: unknown): ProviderLoadAlertLinks | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = payload as Record<string, unknown>;
  const normalized: ProviderLoadAlertLinks = {};
  (["merchandising", "fulfillment", "orders"] as const).forEach((key) => {
    const formatted = stringFormatter(value[key]);
    if (formatted) {
      normalized[key] = formatted;
    }
  });
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeMetrics(payload: BlueprintMetricsApi | null | undefined): BlueprintMetrics {
  if (!payload) {
    return fallbackBlueprintMetrics;
  }

  const window = payload.window ?? fallbackBlueprintMetrics.window;
  const orders = payload.orders ?? fallbackBlueprintMetrics.orders;

  return {
    window: {
      days: numberFormatter(window.days, fallbackBlueprintMetrics.window.days),
      start: stringFormatter(window.start) ?? fallbackBlueprintMetrics.window.start,
    },
    orders: {
      total: numberFormatter(orders.total, fallbackBlueprintMetrics.orders.total),
      items: numberFormatter(orders.items, fallbackBlueprintMetrics.orders.items),
      itemRevenue: numberFormatter(orders.itemRevenue, fallbackBlueprintMetrics.orders.itemRevenue),
    },
    options: sanitizeOptions(payload.options),
    addOns: sanitizeAddOns(payload.addOns),
    providerEngagements: sanitizeProviders(payload.providerEngagements),
    presets: sanitizePresets(payload.presets),
    presetProviderEngagements: sanitizePresetProviderEngagements(payload.presetProviderEngagements),
    providerLoadAlerts: sanitizeProviderLoadAlerts(payload.providerLoadAlerts),
  };
}

type FetchBlueprintMetricsOptions = {
  windowDays?: number;
};

export async function fetchBlueprintMetrics(options: FetchBlueprintMetricsOptions = {}): Promise<BlueprintMetrics> {
  if (!apiKeyHeader) {
    return fallbackBlueprintMetrics;
  }

  const params = new URLSearchParams();
  if (options.windowDays && Number.isFinite(options.windowDays)) {
    params.set("window_days", String(options.windowDays));
  }

  const query = params.toString();
  const targetUrl = query
    ? `${apiBaseUrl}/api/v1/reporting/blueprint-metrics?${query}`
    : `${apiBaseUrl}/api/v1/reporting/blueprint-metrics`;

  try {
    const response = await fetch(targetUrl, {
      headers: defaultHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to load blueprint metrics", {
        status: response.status,
        statusText: response.statusText,
      });
      return fallbackBlueprintMetrics;
    }

    const payload = (await response.json()) as BlueprintMetricsApi;
    return normalizeMetrics(payload);
  } catch (error) {
    console.error("Blueprint metrics request failed", error);
    return fallbackBlueprintMetrics;
  }
}
