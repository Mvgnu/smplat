"use client";

// meta: hook: useMarketingPreviewHistory
// meta: feature: marketing-preview-cockpit

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  MarketingPreviewHistoryAggregates,
  MarketingPreviewGovernanceStats,
  MarketingPreviewHistoryNoteSummary
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

const HISTORY_CACHE_KEY = "marketing-preview-history-cache-v1";

export type MarketingPreviewHistoryTimelineEntry = MarketingPreviewTimelineEntry & {
  aggregates: MarketingPreviewHistoryAggregates;
  governance: MarketingPreviewGovernanceStats;
  notes?: MarketingPreviewHistoryNoteSummary;
};

type HistoryCacheParams = Omit<MarketingPreviewHistoryClientParams, "signal">;

type HistoryCachePayload = {
  params: HistoryCacheParams;
  payload: {
    entries: MarketingPreviewHistoryTimelineEntry[];
    total: number;
    limit: number;
    offset: number;
  };
  cachedAt: string;
};

type HistoryFilters = {
  route?: string;
  variant?: "draft" | "published";
  severity?: MarketingPreviewTriageNoteSeverity;
};

const defaultGovernance: MarketingPreviewGovernanceStats = {
  totalActions: 0,
  actionsByKind: {},
  lastActionAt: null
};

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
  notes: coerceNoteSummary(entry.notes)
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
    notes: undefined
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
  a.severity === b.severity;

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
  nextPage: () => void;
  previousPage: () => void;
  resetPagination: () => void;
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

  const params = useMemo<HistoryCacheParams>(
    () => ({
      limit: initialLimit,
      offset: page * initialLimit,
      route: filters.route,
      variant: filters.variant,
      severity: filters.severity
    }),
    [filters.route, filters.severity, filters.variant, initialLimit, page]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    setCache(readCache());

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

  const query = useQuery({
    queryKey: ["marketing-preview-history", params],
    queryFn: ({ signal }) => fetchMarketingPreviewHistory({ ...params, signal }),
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
      offset: query.data.offset
    };
  }, [query.data]);

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
      setFilters((previous) => updater(previous));
      setPage(0);
    },
    []
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
    nextPage,
    previousPage,
    resetPagination
  };
};
