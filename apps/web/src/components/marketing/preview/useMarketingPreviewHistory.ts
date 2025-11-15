"use client";

// meta: hook: useMarketingPreviewHistory
// meta: feature: marketing-preview-cockpit

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  MarketingPreviewHistoryAggregates,
  MarketingPreviewGovernanceStats,
  MarketingPreviewHistoryAnalytics,
  MarketingPreviewHistoryNoteSummary,
  MarketingPreviewLiveDeltaRecord,
  MarketingPreviewNoteRevisionRecord,
  MarketingPreviewRecommendation,
  MarketingPreviewRegressionVelocity,
  MarketingPreviewRemediationActionRecord,
  MarketingPreviewRehearsalActionRecord,
  MarketingPreviewSeverityMomentum,
  MarketingPreviewTimeToGreenForecast
} from "@/server/cms/history";
import type { MarketingPreviewTriageNoteSeverity } from "@/server/cms/preview/notes";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewTimelineEntry
} from "@/server/cms/preview";

import {
  fetchMarketingPreviewHistory,
  type MarketingPreviewHistoryClientParams,
  type MarketingPreviewHistoryEntryResponse
} from "./historyClient";
import { primeHistoryClientCache } from "./historyClientCache";

const HISTORY_CACHE_KEY = "marketing-preview-history-cache-v3";

export type MarketingPreviewHistoryTimelineEntry = MarketingPreviewTimelineEntry & {
  aggregates: MarketingPreviewHistoryAggregates;
  governance: MarketingPreviewGovernanceStats;
  notes?: MarketingPreviewHistoryNoteSummary;
  liveDeltas: MarketingPreviewLiveDeltaRecord[];
  remediations: MarketingPreviewRemediationActionRecord[];
  rehearsals: MarketingPreviewRehearsalActionRecord[];
  noteRevisions: MarketingPreviewNoteRevisionRecord[];
};

type HistoryCacheParams = Omit<MarketingPreviewHistoryClientParams, "signal">;

type HistoryCachePayload = {
  params: HistoryCacheParams;
  payload: {
    entries: MarketingPreviewHistoryTimelineEntry[];
    total: number;
    limit: number;
    offset: number;
    analytics: MarketingPreviewHistoryAnalytics;
  };
  cachedAt: string;
};

type HistoryFilters = {
  route?: string;
  variant?: "draft" | "published";
  severity?: MarketingPreviewTriageNoteSeverity;
  mode?: "live" | "rehearsal" | "all";
};

const normalizeFilters = (filters: HistoryFilters): HistoryFilters => ({
  route: filters.route || undefined,
  variant: filters.variant || undefined,
  severity: filters.severity || undefined,
  mode: filters.mode || undefined,
});

const filtersEqual = (a: HistoryFilters, b: HistoryFilters): boolean =>
  a.route === b.route &&
  a.variant === b.variant &&
  a.severity === b.severity &&
  a.mode === b.mode;

const defaultGovernance: MarketingPreviewGovernanceStats = {
  totalActions: 0,
  actionsByKind: {},
  lastActionAt: null
};

type HistoryClientResponse = Awaited<ReturnType<typeof fetchMarketingPreviewHistory>>;

const splitSnapshotsByPreview = (
  snapshots: MarketingPreviewSnapshot[]
): Record<"published" | "draft", MarketingPreviewSnapshot[]> => {
  const state: Record<"published" | "draft", MarketingPreviewSnapshot[]> = {
    published: [],
    draft: []
  };

  for (const snapshot of snapshots) {
    if (snapshot.preview) {
      state.draft.push(snapshot);
    } else {
      state.published.push(snapshot);
    }
  }

  state.published.sort((a, b) => a.route.localeCompare(b.route));
  state.draft.sort((a, b) => a.route.localeCompare(b.route));

  return state;
};

const coerceNoteSummary = (
  summary: MarketingPreviewHistoryNoteSummary | undefined
): MarketingPreviewHistoryNoteSummary | undefined => {
  if (!summary) {
    return undefined;
  }

  return {
    total: summary.total,
    severityCounts: {
      info: summary.severityCounts.info ?? 0,
      warning: summary.severityCounts.warning ?? 0,
      blocker: summary.severityCounts.blocker ?? 0
    }
  };
};

const convertHistoryEntry = (
  entry: MarketingPreviewHistoryEntryResponse
): MarketingPreviewHistoryTimelineEntry => ({
  id: entry.id,
  generatedAt: entry.generatedAt,
  label: entry.label ?? undefined,
  routes: entry.routes.map((route) => ({
    route: route.route,
    hasDraft: route.hasDraft,
    hasPublished: route.hasPublished,
    diffDetected: route.diffDetected,
    sectionCount: route.sectionCount,
    blockKinds: route.blockKinds
  })),
  snapshots: splitSnapshotsByPreview(entry.manifest.snapshots),
  aggregates: entry.aggregates,
  governance: {
    totalActions: entry.governance.totalActions,
    actionsByKind: entry.governance.actionsByKind,
    lastActionAt: entry.governance.lastActionAt ?? null
  },
  notes: coerceNoteSummary(entry.notes),
  liveDeltas: entry.liveDeltas ?? [],
  remediations: entry.remediations ?? [],
  rehearsals: entry.rehearsals ?? [],
  noteRevisions: entry.noteRevisions ?? []
});

const deriveAggregates = (
  entry: MarketingPreviewTimelineEntry
): MarketingPreviewHistoryAggregates => {
  const totalRoutes = entry.routes.length;
  let diffDetectedRoutes = 0;
  let draftRoutes = 0;
  let publishedRoutes = 0;

  for (const route of entry.routes) {
    if (route.diffDetected) {
      diffDetectedRoutes += 1;
    }
    if (route.hasDraft) {
      draftRoutes += 1;
    }
    if (route.hasPublished) {
      publishedRoutes += 1;
    }
  }

  return {
    totalRoutes,
    diffDetectedRoutes,
    draftRoutes,
    publishedRoutes
  };
};

const hydrateInitialEntries = (
  entries: MarketingPreviewTimelineEntry[]
): MarketingPreviewHistoryTimelineEntry[] =>
  entries.map((entry) => ({
    ...entry,
    aggregates: deriveAggregates(entry),
    governance: defaultGovernance,
    notes: undefined,
    liveDeltas: [],
    remediations: [],
    rehearsals: [],
    noteRevisions: []
  }));

const readCache = (): HistoryCachePayload | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as HistoryCachePayload;
    if (!parsed?.payload?.analytics) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (payload: HistoryCachePayload) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Swallow storage quota errors; cache is a resilience helper.
  }
};

const paramsEqual = (a: HistoryCacheParams, b: HistoryCacheParams) =>
  a.limit === b.limit &&
  a.offset === b.offset &&
  a.route === b.route &&
  a.variant === b.variant &&
  a.actionMode === b.actionMode &&
  a.severity === b.severity;

const HOURS_IN_MS = 60 * 60 * 1000;

const computeRegressionVelocity = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): MarketingPreviewRegressionVelocity => {
  const sorted = [...entries]
    .map((entry) => ({ timestamp: Date.parse(entry.generatedAt), diff: entry.aggregates.diffDetectedRoutes }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length < 2) {
    return { averagePerHour: 0, currentPerHour: 0, sampleSize: sorted.length, confidence: 0 };
  }

  const velocities: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const elapsed = (current.timestamp - previous.timestamp) / HOURS_IN_MS;
    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      continue;
    }
    velocities.push((current.diff - previous.diff) / elapsed);
  }

  if (!velocities.length) {
    return { averagePerHour: 0, currentPerHour: 0, sampleSize: sorted.length, confidence: 0.1 };
  }

  const average = velocities.reduce((total, value) => total + value, 0) / velocities.length;
  const current = velocities[velocities.length - 1] ?? 0;
  const dispersion = velocities.reduce((total, value) => total + Math.abs(value - average), 0);
  const stability = velocities.length > 1 ? 1 - Math.min(dispersion / velocities.length / Math.max(Math.abs(average), 1), 1) : 0.5;
  const confidence = Math.min(1, 0.35 + 0.15 * velocities.length + stability * 0.5);

  return { averagePerHour: average, currentPerHour: current, sampleSize: sorted.length, confidence };
};

const computeSeverityMomentum = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): MarketingPreviewSeverityMomentum => {
  const sorted = [...entries]
    .map((entry) => ({
      timestamp: Date.parse(entry.generatedAt),
      counts: entry.notes?.severityCounts ?? { info: 0, warning: 0, blocker: 0 }
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length < 2) {
    return { info: 0, warning: 0, blocker: 0, overall: 0, sampleSize: sorted.length };
  }

  const totals = { info: [] as number[], warning: [] as number[], blocker: [] as number[] };

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const elapsed = (current.timestamp - previous.timestamp) / HOURS_IN_MS;
    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      continue;
    }
    totals.info.push((current.counts.info - previous.counts.info) / elapsed);
    totals.warning.push((current.counts.warning - previous.counts.warning) / elapsed);
    totals.blocker.push((current.counts.blocker - previous.counts.blocker) / elapsed);
  }

  const average = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0);

  const info = average(totals.info);
  const warning = average(totals.warning);
  const blocker = average(totals.blocker);
  const overall = (info + warning * 1.5 + blocker * 2.25) / 3.5;

  return { info, warning, blocker, overall, sampleSize: sorted.length };
};

const computeTimeToGreen = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): MarketingPreviewTimeToGreenForecast => {
  const points = [...entries]
    .map((entry) => ({ timestamp: Date.parse(entry.generatedAt), diff: entry.aggregates.diffDetectedRoutes }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length < 2) {
    return { forecastAt: null, forecastHours: null, slopePerHour: null, confidence: 0, sampleSize: points.length };
  }

  const base = points[0]!.timestamp;
  const xs = points.map((point) => (point.timestamp - base) / HOURS_IN_MS);
  const ys = points.map((point) => point.diff);
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  let totalSquared = 0;

  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = ys[index]! - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
    totalSquared += dy * dy;
  }

  if (denominator === 0) {
    return { forecastAt: null, forecastHours: null, slopePerHour: null, confidence: 0, sampleSize: points.length };
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  if (slope >= 0) {
    return { forecastAt: null, forecastHours: null, slopePerHour: slope, confidence: 0.1, sampleSize: points.length };
  }

  const hoursToZero = -intercept / slope;
  const forecastTimestamp = base + hoursToZero * HOURS_IN_MS;
  const latest = points[points.length - 1]!.timestamp;
  const forecastAt = forecastTimestamp > latest ? new Date(forecastTimestamp).toISOString() : null;
  const ssr = points.reduce((total, point, index) => {
    const expected = slope * xs[index]! + intercept;
    const residual = point.diff - expected;
    return total + residual * residual;
  }, 0);
  const sst = totalSquared;
  const confidence = sst === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssr / sst));

  return {
    forecastAt,
    forecastHours: forecastAt ? hoursToZero : null,
    slopePerHour: slope,
    confidence,
    sampleSize: points.length
  };
};

const scoreRecommendations = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): MarketingPreviewRecommendation[] => {
  const ledger = new Map<string, MarketingPreviewRecommendation>();

  const record = (fingerprint: string, occurrence: { recordedAt: string | null; routes: string[] }) => {
    const existing = ledger.get(fingerprint);
    const routes = new Set(existing?.affectedRoutes ?? []);
    for (const route of occurrence.routes) {
      routes.add(route);
    }
    const occurrences = (existing?.occurrences ?? 0) + 1;
    const confidence = Math.min(0.95, 0.35 + Math.log10(occurrences + 1));
    const lastSeenAt = occurrence.recordedAt ?? existing?.lastSeenAt ?? null;
    const suggestion = existing?.suggestion ?? "Review remediation history and align with closest playbook";

    ledger.set(fingerprint, {
      fingerprint,
      suggestion,
      occurrences,
      confidence,
      lastSeenAt,
      affectedRoutes: Array.from(routes)
    });
  };

  for (const entry of entries) {
    const routes = entry.routes.map((route) => route.route);
    for (const remediation of entry.remediations) {
      if (!remediation.fingerprint) {
        continue;
      }
      record(remediation.fingerprint, { recordedAt: remediation.recordedAt ?? null, routes });
    }
  }

  const ranked = Array.from(ledger.values());
  ranked.sort((a, b) => {
    if (b.occurrences === a.occurrences) {
      return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
    }
    return b.occurrences - a.occurrences;
  });

  return ranked;
};

const buildLocalAnalytics = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): MarketingPreviewHistoryAnalytics => ({
  regressionVelocity: computeRegressionVelocity(entries),
  severityMomentum: computeSeverityMomentum(entries),
  timeToGreen: computeTimeToGreen(entries),
  recommendations: scoreRecommendations(entries)
});

type UseMarketingPreviewHistoryOptions = {
  initialEntries: MarketingPreviewTimelineEntry[];
  initialLimit?: number;
};

type UseMarketingPreviewHistoryResult = {
  entries: MarketingPreviewHistoryTimelineEntry[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isOffline: boolean;
  isUsingCache: boolean;
  lastUpdatedAt: string | null;
  error: Error | null;
  availableRoutes: string[];
  filters: HistoryFilters;
  setRouteFilter: (route?: string) => void;
  setSeverityFilter: (severity?: MarketingPreviewTriageNoteSeverity) => void;
  setVariantFilter: (variant?: "draft" | "published") => void;
  setActionModeFilter: (mode?: "live" | "rehearsal" | "all") => void;
  nextPage: () => void;
  previousPage: () => void;
  resetPagination: () => void;
  analytics: MarketingPreviewHistoryAnalytics;
};

export const useMarketingPreviewHistory = ({
  initialEntries,
  initialLimit = 10
}: UseMarketingPreviewHistoryOptions): UseMarketingPreviewHistoryResult => {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [cache, setCache] = useState<HistoryCachePayload | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? false : !navigator.onLine
  );
  const defaultResponseRef = useRef<HistoryClientResponse | null>(null);
  const defaultParamsRef = useRef<HistoryCacheParams | null>(null);
  const params = useMemo<HistoryCacheParams>(
    () => ({
      limit: initialLimit,
      offset: page * initialLimit,
      route: filters.route,
      variant: filters.variant,
      actionMode: filters.mode && filters.mode !== "all" ? filters.mode : undefined,
      severity: filters.severity
    }),
    [filters.mode, filters.route, filters.severity, filters.variant, initialLimit, page]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const cached = readCache();
    setCache(cached);
    if (cached?.payload) {
      defaultResponseRef.current = null;
    }

    const handleOnlineStatus = () => {
      setIsOffline(!navigator.onLine);
    };

    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);

    return () => {
      window.removeEventListener("online", handleOnlineStatus);
      window.removeEventListener("offline", handleOnlineStatus);
    };
  }, []);

  const initialHistory = useMemo(
    () => hydrateInitialEntries(initialEntries),
    [initialEntries]
  );
  const initialAnalytics = useMemo(() => buildLocalAnalytics(initialHistory), [initialHistory]);

  const query = useQuery({
    queryKey: ["marketing-preview-history", params],
    queryFn: async ({ signal }) => {
      const payload = await fetchMarketingPreviewHistory({ ...params, signal });
      return payload;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000
  });

  const queryPayload = useMemo(() => {
    if (!query.data) {
      return null;
    }

    const entries = query.data.entries.map(convertHistoryEntry);

    return {
      entries,
      total: query.data.total,
      limit: query.data.limit,
      offset: query.data.offset,
      analytics: query.data.analytics
    };
  }, [query.data]);

  useEffect(() => {
    if (!query.data || params.actionMode || params.offset !== 0) {
      return;
    }

    defaultResponseRef.current = query.data;
    defaultParamsRef.current = {
      limit: params.limit,
      offset: params.offset,
      route: params.route,
      variant: params.variant,
      actionMode: undefined,
      severity: params.severity
    };
  }, [params, query.data]);

  useEffect(() => {
    if (!queryPayload) {
      return;
    }

    const payload: HistoryCachePayload = {
      params,
      payload: queryPayload,
      cachedAt: new Date().toISOString()
    };

    writeCache(payload);
    setCache(payload);
  }, [params, queryPayload]);

  const activePayload = useMemo(() => {
    if (queryPayload) {
      return queryPayload;
    }

    if (cache && paramsEqual(cache.params, params)) {
      return cache.payload;
    }

    return null;
  }, [cache, params, queryPayload]);

  const entries = activePayload?.entries ?? initialHistory;
  const total = activePayload?.total ?? initialHistory.length;
  const analytics = activePayload?.analytics ?? initialAnalytics;

  const availableRoutes = useMemo(() => {
    const source = activePayload?.entries ?? cache?.payload.entries ?? initialHistory;
    const routes = new Set<string>();
    for (const entry of source) {
      for (const route of entry.routes) {
        routes.add(route.route);
      }
    }
    return Array.from(routes).sort((a, b) => a.localeCompare(b));
  }, [activePayload?.entries, cache?.payload.entries, initialHistory]);

  const hasNextPage = useMemo(() => {
    if (!activePayload) {
      return false;
    }
    return activePayload.offset + activePayload.limit < activePayload.total;
  }, [activePayload]);

  const lastUpdatedAt = queryPayload
    ? new Date().toISOString()
    : cache && paramsEqual(cache.params, params)
      ? cache.cachedAt
      : null;

  const updateFilters = useCallback(
    (updater: (filters: HistoryFilters) => HistoryFilters) => {
      setFilters((previous) => {
        const next = normalizeFilters(updater(previous));
        if (filtersEqual(previous, next)) {
          return previous;
        }
        setPage(0);
        return next;
      });
    },
    [setPage]
  );

  const setRouteFilter = useCallback(
    (route?: string) => {
      updateFilters((previous) => ({ ...previous, route }));
    },
    [updateFilters]
  );

  const setSeverityFilter = useCallback(
    (severity?: MarketingPreviewTriageNoteSeverity) => {
      updateFilters((previous) => ({ ...previous, severity }));
    },
    [updateFilters]
  );

  const setVariantFilter = useCallback(
    (variant?: "draft" | "published") => {
      updateFilters((previous) => ({ ...previous, variant }));
    },
    [updateFilters]
  );

  const primeDefaultModeCache = useCallback(
    (next: HistoryFilters) => {
      if (!defaultResponseRef.current || !defaultParamsRef.current) {
        return;
      }
      const pendingParams: HistoryCacheParams = {
        limit: initialLimit,
        offset: 0,
        route: next.route,
        variant: next.variant,
        actionMode: undefined,
        severity: next.severity
      };
      if (paramsEqual(defaultParamsRef.current, pendingParams)) {
        primeHistoryClientCache(pendingParams, defaultResponseRef.current);
      }
    },
    [initialLimit]
  );

  const setActionModeFilter = useCallback(
    (mode?: "live" | "rehearsal" | "all") => {
      const normalized = mode === "all" ? undefined : mode;
      setFilters((previous) => {
        const next = normalizeFilters({ ...previous, mode: normalized });
        if (filtersEqual(previous, next)) {
          return previous;
        }
        if (previous.mode && !next.mode) {
          primeDefaultModeCache(next);
        }
        setPage(0);
        return next;
      });
    },
    [primeDefaultModeCache]
  );

  const nextPage = useCallback(() => {
    setPage((current) => (hasNextPage ? current + 1 : current));
  }, [hasNextPage]);

  const previousPage = useCallback(() => {
    setPage((current) => (current > 0 ? current - 1 : current));
  }, []);

  const resetPagination = useCallback(() => {
    setPage(0);
  }, []);

  return {
    entries,
    total,
    page,
    limit: initialLimit,
    hasNextPage,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isOffline,
    isUsingCache: Boolean(!queryPayload && cache && paramsEqual(cache.params, params)),
    lastUpdatedAt,
    error: (query.error as Error) ?? null,
    availableRoutes,
    filters,
    setRouteFilter,
    setSeverityFilter,
    setVariantFilter,
    setActionModeFilter,
    nextPage,
    previousPage,
    resetPagination,
    analytics
  };
};
