"use client";

// meta: component: PreviewWorkbench
// meta: feature: marketing-preview-cockpit

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type {
  MarketingPreviewSnapshot,
  MarketingPreviewTimelineEntry
} from "@/server/cms/preview";
import type { MarketingPreviewHistoryAggregates } from "@/server/cms/history";
import type {
  MarketingPreviewTriageNote,
  MarketingPreviewTriageNoteSeverity
} from "@/server/cms/preview/notes";
import {
  useLivePreview,
  type LivePreviewConnectionState,
  type LiveValidationEntry,
  type LivePreviewVariantDescriptor,
  type RouteDiagnosticsAggregatedState,
  type RouteDiagnosticsVariantState,
  type LiveBlockDiffStatus,
  type LiveRegressionHotspot
} from "./useLivePreview";
import {
  useMarketingPreviewHistory,
  type MarketingPreviewHistoryTimelineEntry
} from "./useMarketingPreviewHistory";
import { BlockDiagnosticsPanel } from "./BlockDiagnosticsPanel";

const formatDateTime = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
};

type RouteGroup = {
  route: string;
  published?: MarketingPreviewSnapshot;
  draft?: MarketingPreviewSnapshot;
};

const buildRouteGroups = (entry?: MarketingPreviewTimelineEntry): RouteGroup[] => {
  if (!entry) {
    return [];
  }

  const groups = new Map<string, RouteGroup>();

  for (const snapshot of entry.snapshots.published) {
    groups.set(snapshot.route, { route: snapshot.route, published: snapshot });
  }

  for (const snapshot of entry.snapshots.draft) {
    const existing = groups.get(snapshot.route);
    if (existing) {
      existing.draft = snapshot;
    } else {
      groups.set(snapshot.route, { route: snapshot.route, draft: snapshot });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.route.localeCompare(b.route));
};

const summarizeBlocks = (snapshot?: MarketingPreviewSnapshot) => {
  if (!snapshot) {
    return "No data";
  }
  const kinds = snapshot.blockKinds.length ? snapshot.blockKinds.join(", ") : "No marketing blocks";
  return `${snapshot.sectionCount} sections · ${kinds}`;
};

const summarizeMetrics = (snapshot?: MarketingPreviewSnapshot) => {
  if (!snapshot?.metrics) {
    return "No metrics block";
  }

  const { label, values } = snapshot.metrics;
  const valueSummary = values
    .map((value) => [value.label, value.value].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(" · ");

  return label ? `${label} — ${valueSummary}` : valueSummary;
};

type DiffLine = {
  kind: "same" | "added" | "removed" | "changed";
  lineNumber: number;
  published?: string;
  draft?: string;
};

const computeDiff = (publishedMarkup?: string, draftMarkup?: string): DiffLine[] => {
  const publishedLines = (publishedMarkup ?? "").split(/\r?\n/);
  const draftLines = (draftMarkup ?? "").split(/\r?\n/);
  const length = Math.max(publishedLines.length, draftLines.length);
  const lines: DiffLine[] = [];

  for (let index = 0; index < length; index += 1) {
    const publishedLine = publishedLines[index];
    const draftLine = draftLines[index];
    const lineNumber = index + 1;

    if (publishedLine === draftLine) {
      lines.push({ kind: "same", lineNumber, published: publishedLine, draft: draftLine });
      continue;
    }

    if ((publishedLine ?? "").length === 0 && (draftLine ?? "").length > 0) {
      lines.push({ kind: "added", lineNumber, draft: draftLine });
      continue;
    }

    if ((draftLine ?? "").length === 0 && (publishedLine ?? "").length > 0) {
      lines.push({ kind: "removed", lineNumber, published: publishedLine });
      continue;
    }

    lines.push({ kind: "changed", lineNumber, published: publishedLine, draft: draftLine });
  }

  return lines;
};

type ViewMode = "diff" | "published" | "draft";

const severityStyles: Record<MarketingPreviewTriageNoteSeverity, string> = {
  info: "bg-sky-500/20 text-sky-100",
  warning: "bg-amber-500/20 text-amber-100",
  blocker: "bg-rose-500/20 text-rose-100"
};

const severityLabels: Record<MarketingPreviewTriageNoteSeverity, string> = {
  info: "Info",
  warning: "Warning",
  blocker: "Blocker"
};

const severityOptions: Array<{ label: string; value?: MarketingPreviewTriageNoteSeverity }> = [
  { label: "All severities", value: undefined },
  { label: severityLabels.info, value: "info" },
  { label: severityLabels.warning, value: "warning" },
  { label: severityLabels.blocker, value: "blocker" }
];

const variantOptions: Array<{ label: string; value?: "draft" | "published" }> = [
  { label: "All variants", value: undefined },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" }
];

const hasHistoryMetadata = (
  entry: MarketingPreviewTimelineEntry
): entry is MarketingPreviewHistoryTimelineEntry =>
  Boolean((entry as MarketingPreviewHistoryTimelineEntry).aggregates);

const ensureAggregates = (
  entry: MarketingPreviewTimelineEntry
): MarketingPreviewHistoryAggregates => {
  if (hasHistoryMetadata(entry)) {
    return entry.aggregates;
  }

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

const getNoteSummary = (
  entry: MarketingPreviewTimelineEntry
): MarketingPreviewHistoryTimelineEntry["notes"] =>
  hasHistoryMetadata(entry) ? entry.notes : undefined;

const blockStatusStyles = {
  ok: "bg-emerald-500/20 text-emerald-100",
  warn: "bg-amber-500/20 text-amber-100",
  error: "bg-rose-500/20 text-rose-100"
};

const blockStatusLabels = {
  ok: "Valid",
  warn: "Warnings",
  error: "Errors"
};

const diffStatusOrder: LiveBlockDiffStatus[] = [
  "regressed",
  "improved",
  "added",
  "removed"
];

const diffStatusLabels: Record<LiveBlockDiffStatus, string> = {
  added: "Added",
  removed: "Removed",
  regressed: "Regressed",
  improved: "Improved",
  steady: "Steady"
};

const diffStatusStyles: Record<LiveBlockDiffStatus, string> = {
  added: "bg-sky-500/20 text-sky-100",
  removed: "bg-slate-500/20 text-white/70",
  regressed: "bg-rose-500/20 text-rose-100",
  improved: "bg-emerald-500/20 text-emerald-100",
  steady: "bg-white/10 text-white/60"
};

const MOMENTUM_THRESHOLD = 0.05;

const formatVelocity = (value: number) => {
  const magnitude = Math.abs(value);
  const prefix = value > MOMENTUM_THRESHOLD ? "▲" : value < -MOMENTUM_THRESHOLD ? "▼" : "≈";
  return `${prefix} ${magnitude.toFixed(1)} routes/hr`;
};

const formatMomentum = (value: number) => {
  const prefix = value > MOMENTUM_THRESHOLD ? "+" : value < -MOMENTUM_THRESHOLD ? "" : "≈";
  if (prefix === "≈") {
    return `${prefix}0/hr`;
  }
  return `${prefix}${Math.abs(value).toFixed(2)}/hr`;
};

const momentumClass = (value: number) => {
  if (value > MOMENTUM_THRESHOLD) {
    return "bg-rose-500/20 text-rose-100";
  }
  if (value < -MOMENTUM_THRESHOLD) {
    return "bg-emerald-500/20 text-emerald-100";
  }
  return "bg-white/10 text-white/60";
};

const formatConfidence = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}% confidence`;

const SPARKLINE_WIDTH = 140;
const SPARKLINE_HEIGHT = 40;

const buildRegressionSparklinePath = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): string | null => {
  if (entries.length < 2) {
    return null;
  }
  const sorted = [...entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const values = sorted.map((entry) => entry.aggregates.diffDetectedRoutes);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  return sorted
    .map((entry, index) => {
      const x = (index / (sorted.length - 1)) * SPARKLINE_WIDTH;
      const y =
        SPARKLINE_HEIGHT -
        ((entry.aggregates.diffDetectedRoutes - min) / range) * SPARKLINE_HEIGHT;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const buildSeveritySparklinePath = (
  entries: MarketingPreviewHistoryTimelineEntry[]
): string | null => {
  if (entries.length < 2) {
    return null;
  }
  const sorted = [...entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const values = sorted.map((entry) => {
    const counts = entry.notes?.severityCounts;
    if (!counts) {
      return 0;
    }
    return counts.info + counts.warning * 2 + counts.blocker * 3;
  });
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  return sorted
    .map((entry, index) => {
      const x = (index / (sorted.length - 1)) * SPARKLINE_WIDTH;
      const value = values[index]!;
      const y = SPARKLINE_HEIGHT - ((value - min) / range) * SPARKLINE_HEIGHT;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

type OperatorFeedbackEntry = {
  id: string | null;
  body: string;
  submittedAt: string;
  hashPreview: string | null;
};

const hashOperatorIdentifier = async (identifier: string): Promise<string> => {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return "";
  }
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return btoa(trimmed).slice(0, 24);
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(trimmed);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const connectionBadgeStyles: Record<LivePreviewConnectionState, string> = {
  connecting: "bg-amber-500/20 text-amber-100",
  connected: "bg-emerald-500/20 text-emerald-100",
  disconnected: "bg-rose-500/20 text-rose-100"
};

const connectionBadgeLabels: Record<LivePreviewConnectionState, string> = {
  connecting: "Connecting stream",
  connected: "Live stream",
  disconnected: "Stream offline"
};

const classifyBlockStatus = (block: LiveValidationEntry["blocks"][number]): "ok" | "warn" | "error" => {
  if (!block.valid || block.errors.length > 0) {
    return "error";
  }
  if (block.warnings.length > 0) {
    return "warn";
  }
  return "ok";
};

const determineValidationBadge = (
  state: LivePreviewConnectionState,
  entry?: LiveValidationEntry
) => {
  if (entry) {
    const hasErrors = !entry.valid || entry.blocks.some((block) => classifyBlockStatus(block) === "error");
    const hasWarnings =
      !hasErrors &&
      (entry.warnings.length > 0 || entry.blocks.some((block) => classifyBlockStatus(block) === "warn"));

    if (hasErrors) {
      return { label: "Live errors", className: blockStatusStyles.error };
    }
    if (hasWarnings) {
      return { label: "Live warnings", className: blockStatusStyles.warn };
    }
    return { label: "Live clean", className: blockStatusStyles.ok };
  }

  if (state === "connected") {
    return { label: "Awaiting stream", className: "bg-white/10 text-white/60" };
  }
  if (state === "connecting") {
    return { label: "Connecting", className: connectionBadgeStyles.connecting };
  }
  return { label: "Stream offline", className: "bg-white/10 text-white/50" };
};

const noteKey = (generatedAt: string, route: string) => `${generatedAt}::${route}`;

type PreviewWorkbenchProps = {
  current: MarketingPreviewTimelineEntry;
  history: MarketingPreviewTimelineEntry[];
  notes?: MarketingPreviewTriageNote[];
};

export function PreviewWorkbench({ current, history, notes = [] }: PreviewWorkbenchProps) {
  const {
    entries: persistedHistoryEntries,
    total: historyTotal,
    page: historyPage,
    limit: historyLimit,
    hasNextPage: historyHasNextPage,
    isLoading: isHistoryLoading,
    isFetching: isHistoryFetching,
    isOffline: isHistoryOffline,
    isUsingCache: historyUsingCache,
    lastUpdatedAt: historyLastUpdatedAt,
    error: historyError,
    availableRoutes: historyAvailableRoutes,
    filters: historyFilters,
    setRouteFilter,
    setSeverityFilter,
    setVariantFilter,
    nextPage: historyNextPage,
    previousPage: historyPreviousPage,
    analytics: historyAnalytics
  } = useMarketingPreviewHistory({ initialEntries: history });
  const {
    timelineEntries,
    connectionState,
    validationQueue,
    clearValidationQueue,
    routeValidation,
    routeDiagnostics,
    variants: variantCatalog,
    baselineVariantKey
  } = useLivePreview({ current, history: persistedHistoryEntries });
  const [selectedEntryId, setSelectedEntryId] = useState(timelineEntries[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [localNotes, setLocalNotes] = useState<MarketingPreviewTriageNote[]>(notes);
  const [noteBody, setNoteBody] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("");
  const [noteSeverity, setNoteSeverity] = useState<MarketingPreviewTriageNoteSeverity>("info");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackIdentifier, setFeedbackIdentifier] = useState("");
  const [feedbackEntries, setFeedbackEntries] = useState<OperatorFeedbackEntry[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");

  const handleFeedbackSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = feedbackBody.trim();
      if (!trimmed) {
        setFeedbackStatus("error");
        return;
      }
      setFeedbackStatus("submitting");
      try {
        const hashed = feedbackIdentifier.trim()
          ? await hashOperatorIdentifier(feedbackIdentifier)
          : "";
        const entry: OperatorFeedbackEntry = {
          id: hashed || null,
          body: trimmed,
          submittedAt: new Date().toISOString(),
          hashPreview: hashed ? hashed.slice(0, 12) : null
        };
        setFeedbackEntries((previous) => [entry, ...previous].slice(0, 5));
        setFeedbackBody("");
        setFeedbackIdentifier("");
        setFeedbackStatus("submitted");
        if (typeof window !== "undefined") {
          window.setTimeout(() => setFeedbackStatus("idle"), 2500);
        }
      } catch (submissionError) {
        console.error(submissionError);
        setFeedbackStatus("error");
      }
    },
    [feedbackBody, feedbackIdentifier]
  );

  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  useEffect(() => {
    if (!timelineEntries.length) {
      setSelectedEntryId("");
      return;
    }
    if (!timelineEntries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(timelineEntries[0]?.id ?? "");
    }
  }, [selectedEntryId, timelineEntries]);

  const activeEntry = useMemo(() => {
    return (
      timelineEntries.find((entry) => entry.id === selectedEntryId) ?? timelineEntries[0] ?? null
    );
  }, [selectedEntryId, timelineEntries]);

  const historyEntryLookup = useMemo(
    () => new Map(persistedHistoryEntries.map((entry) => [entry.id, entry])),
    [persistedHistoryEntries]
  );
  const regressionSparklinePath = useMemo(
    () => buildRegressionSparklinePath(persistedHistoryEntries),
    [persistedHistoryEntries]
  );
  const severitySparklinePath = useMemo(
    () => buildSeveritySparklinePath(persistedHistoryEntries),
    [persistedHistoryEntries]
  );
  const topRecommendations = useMemo(
    () => historyAnalytics.recommendations.slice(0, 3),
    [historyAnalytics.recommendations]
  );
  const severityMomentumTokens = useMemo(
    () => [
      { label: "Info", value: historyAnalytics.severityMomentum.info },
      { label: "Warning", value: historyAnalytics.severityMomentum.warning },
      { label: "Blocker", value: historyAnalytics.severityMomentum.blocker }
    ],
    [
      historyAnalytics.severityMomentum.blocker,
      historyAnalytics.severityMomentum.info,
      historyAnalytics.severityMomentum.warning
    ]
  );

  const routeGroups = useMemo(() => buildRouteGroups(activeEntry ?? undefined), [activeEntry]);
  const [selectedRoute, setSelectedRoute] = useState(
    historyFilters.route ?? routeGroups[0]?.route ?? ""
  );
  const [selectedVariantKey, setSelectedVariantKey] = useState(baselineVariantKey);

  useEffect(() => {
    if (!routeGroups.length) {
      setSelectedRoute("");
      return;
    }
    setSelectedRoute((currentRoute) => {
      if (historyFilters.route && routeGroups.some((group) => group.route === historyFilters.route)) {
        return historyFilters.route;
      }
      if (routeGroups.some((group) => group.route === currentRoute)) {
        return currentRoute;
      }
      return routeGroups[0]?.route ?? "";
    });
  }, [historyFilters.route, routeGroups]);

  useEffect(() => {
    setViewMode("diff");
  }, [selectedEntryId]);

  useEffect(() => {
    setSelectedVariantKey((currentKey) => {
      const availableKeys = variantCatalog.map((variant) => variant.key);
      if (availableKeys.includes(currentKey)) {
        return currentKey;
      }
      return baselineVariantKey;
    });
  }, [variantCatalog, baselineVariantKey]);

  const activeGroup = useMemo(() => {
    if (!routeGroups.length) {
      return undefined;
    }
    return routeGroups.find((group) => group.route === selectedRoute) ?? routeGroups[0];
  }, [routeGroups, selectedRoute]);

  const diffLines = useMemo(
    () => computeDiff(activeGroup?.published?.markup, activeGroup?.draft?.markup),
    [activeGroup?.published?.markup, activeGroup?.draft?.markup]
  );

  const hasDifferences = diffLines.some((line) => line.kind !== "same");
  const snapshotForView = viewMode === "draft" ? activeGroup?.draft : activeGroup?.published;
  const activeValidation = activeGroup ? routeValidation[activeGroup.route] : undefined;
  const routeDiagnosticsState = useMemo(
    () => (activeGroup ? routeDiagnostics[activeGroup.route] : undefined),
    [activeGroup, routeDiagnostics]
  );
  const routeVariantKeys = useMemo(
    () => routeDiagnosticsState?.aggregated.variantKeys ?? [],
    [routeDiagnosticsState]
  );
  const routeVariantKeySignature = useMemo(
    () => routeVariantKeys.join("|"),
    [routeVariantKeys]
  );

  useEffect(() => {
    if (!routeDiagnosticsState) {
      return;
    }
    setSelectedVariantKey((currentKey) => {
      if (routeVariantKeys.includes(currentKey)) {
        return currentKey;
      }
      return routeDiagnosticsState.aggregated.baselineKey ?? baselineVariantKey;
    });
  }, [
    routeDiagnosticsState,
    routeVariantKeySignature,
    routeDiagnosticsState?.aggregated.baselineKey,
    baselineVariantKey,
    routeVariantKeys
  ]);

  const effectiveVariantKey = routeVariantKeys.includes(selectedVariantKey)
    ? selectedVariantKey
    : routeDiagnosticsState?.aggregated.baselineKey ?? baselineVariantKey;
  const activeVariantDiagnostics = effectiveVariantKey
    ? routeDiagnosticsState?.variants[effectiveVariantKey]
    : undefined;
  const activeDiagnostics = activeVariantDiagnostics?.latest;
  const diagnosticsHistory = activeVariantDiagnostics?.history ?? [];
  const variantDescriptor = activeVariantDiagnostics?.descriptor ??
    variantCatalog.find((variant) => variant.key === effectiveVariantKey);
  const aggregatedDiagnostics = routeDiagnosticsState?.aggregated;
  const sinceLastGreen = activeVariantDiagnostics?.sinceLastGreen;
  const diffSummary = activeVariantDiagnostics?.diffSummary;
  const routeVariantOptions = useMemo(() => {
    if (!routeDiagnosticsState) {
      return [];
    }
    return routeVariantKeys
      .map((key) => routeDiagnosticsState.variants[key]?.descriptor ??
        variantCatalog.find((variant) => variant.key === key))
      .filter((descriptor): descriptor is LivePreviewVariantDescriptor => Boolean(descriptor));
  }, [routeDiagnosticsState, routeVariantKeys, variantCatalog]);
  const variantDrift = effectiveVariantKey
    ? aggregatedDiagnostics?.driftByVariant[effectiveVariantKey]
    : undefined;
  const variantDiffTotals: Record<LiveBlockDiffStatus, number> = diffSummary ?? {
    added: 0,
    removed: 0,
    regressed: 0,
    improved: 0,
    steady: 0
  };
  const regressionHotspots = useMemo(() => {
    const variantsByKey = routeDiagnosticsState?.variants ?? {};
    return (aggregatedDiagnostics?.regressionHotspots ?? []).map<
      LiveRegressionHotspot & { variantLabel: string }
    >((hotspot) => {
      const descriptor =
        variantsByKey[hotspot.variantKey]?.descriptor ??
        variantCatalog.find((variant) => variant.key === hotspot.variantKey);
      return {
        ...hotspot,
        variantLabel: descriptor?.label ?? hotspot.variantKey
      };
    });
  }, [aggregatedDiagnostics?.regressionHotspots, routeDiagnosticsState?.variants, variantCatalog]);
  const activeValidationBadge = determineValidationBadge(connectionState, activeValidation);

  const noteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of localNotes) {
      const key = noteKey(note.generatedAt, note.route);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [localNotes]);

  const routeNotes = useMemo(() => {
    if (!activeEntry || !activeGroup) {
      return [];
    }
    return localNotes.filter(
      (note) => note.generatedAt === activeEntry.generatedAt && note.route === activeGroup.route
    );
  }, [activeEntry, activeGroup, localNotes]);

  const changedRouteCount = activeEntry?.routes.filter((route) => route.diffDetected).length ?? 0;
  const totalRoutes = activeEntry?.routes.length ?? routeGroups.length;
  const historyTotalPages = Math.max(1, Math.ceil(Math.max(historyTotal, 1) / historyLimit));
  const isHistoryBusy = isHistoryLoading || isHistoryFetching;
  const historyUpdatedLabel = historyLastUpdatedAt ? formatDateTime(historyLastUpdatedAt) : null;

  const handleSubmitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeEntry || !activeGroup || !activeGroup.route) {
      return;
    }

    setError(null);
    const payload = {
      route: activeGroup.route,
      generatedAt: activeEntry.generatedAt,
      body: noteBody,
      author: noteAuthor.trim() ? noteAuthor.trim() : undefined,
      severity: noteSeverity
    };

    startTransition(async () => {
      try {
        const response = await fetch("/api/marketing-preview/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to save note");
        }

        const data = (await response.json()) as { note: MarketingPreviewTriageNote };
        setLocalNotes((previous) => [data.note, ...previous]);
        setNoteBody("");
        setError(null);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : "Failed to save note");
      }
    });
  };

  return (
    <section className="grid gap-8 xl:grid-cols-[320px_1fr]">
      <aside className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Timeline</p>
            <p className="text-sm text-white/70">
              {timelineEntries.length} capture{timelineEntries.length === 1 ? "" : "s"} · {changedRouteCount}/
              {totalRoutes} active diffs
            </p>
            <p className="text-[11px] text-white/50">
              {historyTotal} persisted manifest{historyTotal === 1 ? "" : "s"} · page {historyPage + 1} of {historyTotalPages}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]">
              <span className={`inline-flex items-center rounded-full px-3 py-1 ${connectionBadgeStyles[connectionState]}`}>
                {connectionBadgeLabels[connectionState]}
              </span>
              {historyUsingCache ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-3 py-1 text-amber-100">
                  Offline cache
                </span>
              ) : null}
              {isHistoryBusy ? (
                <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-white/60">
                  Refreshing…
                </span>
              ) : null}
              {historyUpdatedLabel ? (
                <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-white/60">
                  Updated {historyUpdatedLabel}
                </span>
              ) : null}
            </div>
            {isHistoryOffline && !historyUsingCache ? (
              <p className="text-xs text-amber-200">
                Offline detected — cached captures are shown until the history API is reachable again.
              </p>
            ) : null}
            {historyError ? (
              <p className="text-xs text-rose-200">{historyError.message}</p>
            ) : null}
          </header>

          <div className="mt-5 space-y-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Variants</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {variantOptions.map(({ value, label }) => {
                  const isActive = value ? historyFilters.variant === value : !historyFilters.variant;
                  return (
                    <button
                      key={value ?? "all"}
                      type="button"
                      onClick={() => setVariantFilter(isActive ? undefined : value)}
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] transition ${
                        isActive
                          ? "border-white/40 bg-white/20 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Severity</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {severityOptions.map(({ value, label }) => {
                  const isActive = value ? historyFilters.severity === value : !historyFilters.severity;
                  return (
                    <button
                      key={value ?? "all"}
                      type="button"
                      onClick={() => setSeverityFilter(isActive ? undefined : value)}
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] transition ${
                        isActive
                          ? "border-white/40 bg-white/20 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Routes</p>
              <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setRouteFilter(undefined)}
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] transition ${
                    historyFilters.route
                      ? "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
                      : "border-white/40 bg-white/20 text-white"
                  }`}
                >
                  All routes
                </button>
                {historyAvailableRoutes.map((route) => {
                  const isActive = historyFilters.route === route;
                  return (
                    <button
                      key={route}
                      type="button"
                      onClick={() => setRouteFilter(isActive ? undefined : route)}
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] transition ${
                        isActive
                          ? "border-white/40 bg-white/20 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {route}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2">
                {timelineEntries.map((entry, index) => {
                  const isActive = entry.id === activeEntry?.id;
                  const metadata = historyEntryLookup.get(entry.id);
                  const aggregates = metadata?.aggregates ?? ensureAggregates(entry);
                  const noteSummary = metadata?.notes;
                  const diffPercent = aggregates.totalRoutes
                    ? Math.round((aggregates.diffDetectedRoutes / aggregates.totalRoutes) * 100)
                    : 0;
                  const key = entry.id ?? entry.generatedAt;
                  const label = index === 0 ? "Current capture" : formatDateTime(entry.generatedAt);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedEntryId(entry.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        isActive
                          ? "border-white/40 bg-white/20 text-white shadow-lg"
                          : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="mt-1 text-xs text-white/60">
                        {diffPercent}% diff coverage · {aggregates.totalRoutes} routes · {noteSummary?.total ?? 0} notes
                      </p>
                      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="h-full bg-rose-500/70"
                          style={{ width: `${Math.min(Math.max(diffPercent, 0), 100)}%` }}
                        />
                        <span
                          className="h-full bg-emerald-400/40"
                          style={{ width: `${Math.max(100 - Math.min(Math.max(diffPercent, 0), 100), 0)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-xs text-white/60">
                <button
                  type="button"
                  onClick={historyPreviousPage}
                  disabled={historyPage === 0 || isHistoryBusy}
                  className="rounded-full border border-white/10 px-3 py-1 uppercase tracking-[0.2em] transition disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  Page {historyPage + 1} of {historyTotalPages}
                </span>
                <button
                  type="button"
                  onClick={historyNextPage}
                  disabled={!historyHasNextPage || isHistoryBusy}
                  className="rounded-full border border-white/10 px-3 py-1 uppercase tracking-[0.2em] transition disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-3">
          {routeGroups.map((group) => {
            const isActive = group.route === activeGroup?.route;
            const key = noteKey(activeEntry?.generatedAt ?? "", group.route);
            const noteCount = noteCounts.get(key) ?? 0;
            const summary = activeEntry?.routes.find((route) => route.route === group.route);
            const statusLabel = summary?.diffDetected ? "Diff detected" : "In sync";
            const validationEntry = routeValidation[group.route];
            const validationBadge = determineValidationBadge(connectionState, validationEntry);
            return (
              <button
                key={group.route}
                type="button"
                onClick={() => {
                  setSelectedRoute(group.route);
                }}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  isActive
                    ? "border-white/40 bg-white/20 text-white shadow-lg"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                }`}
              >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">{group.route}</p>
                      <p className="mt-1 text-xs text-white/60">{summarizeBlocks(group.published ?? group.draft)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                          summary?.diffDetected ? "bg-amber-500/20 text-amber-100" : "bg-emerald-500/20 text-emerald-100"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${validationBadge.className}`}
                      >
                        {validationBadge.label}
                      </span>
                      {noteCount > 0 ? (
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/60">
                          {noteCount} note{noteCount === 1 ? "" : "s"}
                        </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-black/40 p-6 backdrop-blur">
          <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Predictive diagnostics</h2>
              <p className="text-xs text-white/60">
                Regression forecasts blend persisted deltas, remediation fingerprints, and note momentum for proactive recovery.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.25em] text-white/60">
              <span
                className={`rounded-full px-3 py-1 font-semibold ${
                  isHistoryOffline ? "bg-amber-500/20 text-amber-100" : "bg-emerald-500/20 text-emerald-100"
                }`}
              >
                {isHistoryOffline ? "Offline cache" : "Live analytics"}
              </span>
              <span
                className={`rounded-full px-3 py-1 font-semibold ${
                  historyUsingCache ? "bg-sky-500/20 text-sky-100" : "bg-white/10 text-white/70"
                }`}
              >
                {historyUsingCache ? "Cache replay" : "Fresh pull"}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/60">
                Sample size {historyAnalytics.regressionVelocity.sampleSize}
              </span>
            </div>
          </header>

          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Regression velocity</p>
              <p className="mt-2 text-xl font-semibold text-white">
                {formatVelocity(historyAnalytics.regressionVelocity.averagePerHour)}
              </p>
              <p className="mt-1 text-xs text-white/50">
                Current {formatVelocity(historyAnalytics.regressionVelocity.currentPerHour)} · {formatConfidence(historyAnalytics.regressionVelocity.confidence)}
              </p>
              {regressionSparklinePath ? (
                <svg
                  viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                  className="mt-3 h-16 w-full text-emerald-300"
                  aria-hidden="true"
                >
                  <path d={regressionSparklinePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <p className="mt-3 text-[11px] text-white/40">Capture additional manifests to unlock a trendline.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Severity momentum</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {severityMomentumTokens.map(({ label, value }) => (
                  <span
                    key={label}
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] ${momentumClass(value)}`}
                  >
                    {label}: {formatMomentum(value)}
                  </span>
                ))}
              </div>
              {severitySparklinePath ? (
                <svg
                  viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                  className="mt-3 h-16 w-full text-rose-200"
                  aria-hidden="true"
                >
                  <path d={severitySparklinePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <p className="mt-3 text-[11px] text-white/40">Severity momentum initializes after multiple annotated captures.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Time to green forecast</p>
              <p className="mt-2 text-xl font-semibold text-white">
                {historyAnalytics.timeToGreen.forecastHours
                  ? `${Math.max(historyAnalytics.timeToGreen.forecastHours, 0).toFixed(1)}h`
                  : "Awaiting signal"}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {historyAnalytics.timeToGreen.forecastAt
                  ? `Projected ${formatDateTime(historyAnalytics.timeToGreen.forecastAt)}`
                  : "Accelerate remediations to improve forecast confidence."}
              </p>
              <p className="mt-2 text-[11px] text-white/40">
                {formatConfidence(historyAnalytics.timeToGreen.confidence)} · Slope {historyAnalytics.timeToGreen.slopePerHour?.toFixed(2) ?? "n/a"}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Recommendation ledger</p>
              {topRecommendations.length ? (
                <ul className="mt-3 space-y-2">
                  {topRecommendations.map((recommendation) => (
                    <li key={recommendation.fingerprint} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                      <p className="font-semibold text-white">{recommendation.suggestion}</p>
                      <p className="mt-1 text-[11px] text-white/50">
                        {recommendation.occurrences} occurrence{recommendation.occurrences === 1 ? "" : "s"} · Hash {recommendation.fingerprint.slice(0, 12)} · {formatConfidence(recommendation.confidence)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-white/60">No recurring remediations detected yet.</p>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <form onSubmit={handleFeedbackSubmit} className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <p className="text-sm font-semibold text-white">Operator feedback</p>
              <p className="mt-1 text-xs text-white/60">
                Share recovery context or upcoming risks. Identifiers are SHA-256 hashed in-browser before logging.
              </p>
              <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-white/60">
                Opportunity
                <textarea
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/60 p-3 text-sm text-white focus:border-white/30 focus:outline-none"
                  rows={3}
                  value={feedbackBody}
                  onChange={(event) => setFeedbackBody(event.target.value)}
                  placeholder="Highlight blockers, ready-to-ship fixes, or additional context"
                />
              </label>
              <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-white/60">
                Optional identifier
                <input
                  type="text"
                  className="mt-1 w-full rounded-full border border-white/10 bg-black/60 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  value={feedbackIdentifier}
                  onChange={(event) => setFeedbackIdentifier(event.target.value)}
                  placeholder="team-handle or email"
                />
              </label>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="submit"
                  disabled={feedbackStatus === "submitting"}
                  className="rounded-full border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/40 disabled:opacity-40"
                >
                  {feedbackStatus === "submitting" ? "Submitting" : "Record feedback"}
                </button>
                {feedbackStatus === "submitted" ? (
                  <span className="text-[11px] text-emerald-200">Captured securely</span>
                ) : feedbackStatus === "error" ? (
                  <span className="text-[11px] text-rose-200">Add context before submitting</span>
                ) : null}
              </div>
            </form>

            <div className="lg:col-span-2">
              <p className="text-sm font-semibold text-white">Recent hashed feedback</p>
              <p className="mt-1 text-xs text-white/60">Visible only in-session for privacy. Use governance notes for durable follow-up.</p>
              {feedbackEntries.length ? (
                <ul className="mt-3 space-y-2">
                  {feedbackEntries.map((entry) => (
                    <li key={`${entry.submittedAt}-${entry.hashPreview ?? "anon"}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/50">
                        <span>{entry.hashPreview ? `id:${entry.hashPreview}` : "id:anonymous"}</span>
                        <span>{formatDateTime(entry.submittedAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-white/70">{entry.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-white/60">No cockpit feedback logged this session.</p>
              )}
            </div>
          </div>

          <p className="mt-6 text-[11px] uppercase tracking-[0.2em] text-white/40">
            Last synced {historyLastUpdatedAt ? formatDateTime(historyLastUpdatedAt) : "with initial payload"}
          </p>
        </section>

        {validationQueue.length > 0 ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Live validation activity</p>
                <p className="mt-1 text-xs text-white/60">
                  Latest payloads from the streaming bridge surface below. Clear the feed after triage.
                </p>
              </div>
              <button
                type="button"
                onClick={clearValidationQueue}
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/60 transition hover:border-white/30 hover:text-white"
              >
                Clear
              </button>
            </div>

            <ul className="mt-4 space-y-3">
              {validationQueue.map((entry) => {
                const badge = determineValidationBadge(connectionState, entry);
                const errorCount = entry.blocks.filter((block) => classifyBlockStatus(block) === "error").length;
                const warningCount =
                  entry.warnings.length + entry.blocks.filter((block) => classifyBlockStatus(block) === "warn").length;

                return (
                  <li
                    key={`${entry.id}-${entry.receivedAt}`}
                    className="rounded-2xl border border-white/10 bg-black/40 p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{entry.route}</p>
                        <p className="mt-1 text-xs text-white/60">Updated {formatDateTime(entry.receivedAt)}</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-white/60">
                      {errorCount} block error{errorCount === 1 ? "" : "s"} · {warningCount} warning signal
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {activeEntry && activeGroup ? (
          <>
            <header className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Route</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{activeGroup.route}</h2>
                  <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/40">
                    Snapshot {formatDateTime(activeEntry.generatedAt)}
                  </p>
                  <p className="mt-3 text-sm text-white/70">
                    Draft hero: {activeGroup.draft?.hero?.headline ?? "–"} • Published hero: {activeGroup.published?.hero?.headline ?? "–"}
                  </p>
                  <p className="mt-1 text-sm text-white/60">Draft metrics: {summarizeMetrics(activeGroup.draft)}</p>
                  <p className="mt-1 text-sm text-white/60">Published metrics: {summarizeMetrics(activeGroup.published)}</p>
                </div>

                <div className="flex flex-col items-start gap-2 md:items-end">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      hasDifferences ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/20 text-emerald-200"
                    }`}
                  >
                    {hasDifferences ? "Block diff detected" : "Draft matches published"}
                  </span>

                  <div className="flex gap-2">
                    {(["diff", "published", "draft"] as ViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                          viewMode === mode
                            ? "border-white/50 bg-white/80 text-black"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2 text-right text-[11px] uppercase tracking-[0.2em] text-white/60">
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.25em] text-white/50">
                      Variant ledger
                      <select
                        className="rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                        value={effectiveVariantKey ?? "variant-baseline"}
                        onChange={(event) => setSelectedVariantKey(event.target.value)}
                      >
                        {routeVariantOptions.length > 0
                          ? routeVariantOptions.map((variant) => (
                              <option key={variant.key} value={variant.key} className="text-black">
                                {variant.label}
                              </option>
                            ))
                          : variantCatalog.map((variant) => (
                              <option key={variant.key} value={variant.key} className="text-black">
                                {variant.label}
                              </option>
                            ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap justify-end gap-2 text-[10px]">
                      <span className="rounded-full bg-rose-500/20 px-3 py-1 font-semibold text-rose-100">
                        Δ invalid {variantDrift?.invalidDelta ?? 0}
                      </span>
                      <span className="rounded-full bg-amber-500/20 px-3 py-1 font-semibold text-amber-100">
                        Δ warnings {variantDrift?.warningDelta ?? 0}
                      </span>
                    </div>
                    {sinceLastGreen ? (
                      <span className="text-[10px] text-white/50">
                        {sinceLastGreen.steps === 0
                          ? "Variant is green"
                          : `Last green ${sinceLastGreen.steps} capture${sinceLastGreen.steps === 1 ? "" : "s"} ago`}
                      </span>
                    ) : null}
                  </div>
                </div>
            </div>
          </header>

            <section className="rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur">
              <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Diff intelligence</h3>
                  <p className="text-xs text-white/60">
                    Tracking {variantDescriptor?.label ?? "Baseline"} against the latest ledger snapshot.
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">
                  {aggregatedDiagnostics?.variantKeys.length ?? 0} variant stream
                  {aggregatedDiagnostics && aggregatedDiagnostics.variantKeys.length === 1 ? "" : "s"}
                </span>
              </header>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {diffStatusOrder.map((status) => (
                  <div
                    key={status}
                    className={`rounded-2xl border border-white/10 px-4 py-3 text-sm ${diffStatusStyles[status]}`}
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-white/60">
                      {diffStatusLabels[status]}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {variantDiffTotals[status] ?? 0}
                    </p>
                  </div>
                ))}
              </div>

              {regressionHotspots.length ? (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Regression hotspots</h4>
                  <ul className="space-y-2 text-xs text-white/70">
                    {regressionHotspots.slice(0, 6).map((hotspot) => (
                      <li
                        key={`${hotspot.blockKey}-${hotspot.variantKey}`}
                        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-white">{hotspot.blockKind ?? "Block"}</span>
                            <span className="ml-2 text-white/50">{hotspot.blockKey}</span>
                          </div>
                          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-rose-100">
                            {hotspot.variantLabel}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
                          <span>Regressions {hotspot.regressionCount}</span>
                          <span>
                            Δ severity {hotspot.severity - (hotspot.previousSeverity ?? 0)}
                          </span>
                          <span>{new Date(hotspot.lastSeenAt).toLocaleString()}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {activeValidation ? (
              <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Live validation</p>
                      <p className="text-xs text-white/60">
                        Received {formatDateTime(activeValidation.receivedAt)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${activeValidationBadge.className}`}
                    >
                      {activeValidationBadge.label}
                    </span>
                  </div>

                  {activeValidation.warnings.length > 0 ? (
                    <ul className="space-y-1 text-xs text-amber-100">
                      {activeValidation.warnings.map((warning, warningIndex) => (
                        <li key={`${activeValidation.id}-global-warning-${warningIndex}`}>• {warning}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="space-y-3">
                    {activeValidation.blocks.map((block, index) => {
                      const status = classifyBlockStatus(block);
                      const badgeClass = blockStatusStyles[status];
                      const label = blockStatusLabels[status];
                      const blockKey = block.key ?? `${block.kind ?? "block"}-${index}`;

                      return (
                        <div key={`${activeValidation.id}-${blockKey}`} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-semibold text-white">{block.kind ?? "Block"}</p>
                            <span
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${badgeClass}`}
                            >
                              {label}
                            </span>
                          </div>
                          {block.errors.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-xs text-rose-100">
                              {block.errors.map((error, errorIndex) => (
                                <li key={`${activeValidation.id}-${blockKey}-error-${errorIndex}`}>• {error}</li>
                              ))}
                            </ul>
                          ) : null}
                          {block.warnings.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-xs text-amber-100">
                              {block.warnings.map((warning, warningIndex) => (
                                <li key={`${activeValidation.id}-${blockKey}-warning-${warningIndex}`}>• {warning}</li>
                              ))}
                            </ul>
                          ) : null}
                  {block.recoveryHints.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-sky-100">
                      {block.recoveryHints.map((hint, hintIndex) => (
                        <li
                          key={`${activeValidation.id}-${blockKey}-hint-${hintIndex}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-sky-100">
                            {hint.category}
                          </span>
                          <span>{hint.message}</span>
                          {hint.fieldPath ? (
                            <span className="text-sky-200/70">({hint.fieldPath})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                          {block.trace.operations.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-[10px] text-white/50">
                              {block.trace.operations.map((operation, operationIndex) => (
                                <li key={`${activeValidation.id}-${blockKey}-operation-${operationIndex}`}>{operation}</li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
                            <span>Trace {block.trace.lexicalIndex}</span>
                            {block.fallback?.used ? <span>Fallback used</span> : null}
                            {block.trace.skipReason ? <span>Skipped</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : connectionState === "disconnected" ? (
              <section className="rounded-3xl border border-white/10 bg-black/40 p-6 text-sm text-white/70">
                Live stream offline — displaying the last persisted snapshot. Resume Payload publishing to
                restore real-time validation.
              </section>
            ) : null}

            {activeGroup ? (
              <BlockDiagnosticsPanel
                route={activeGroup.route}
                entry={activeDiagnostics}
                history={diagnosticsHistory}
                validation={activeValidation}
                variantState={activeVariantDiagnostics}
                aggregated={aggregatedDiagnostics}
                availableVariants={variantCatalog}
                selectedVariantKey={effectiveVariantKey ?? baselineVariantKey}
              />
            ) : null}

            {viewMode === "diff" ? (
              <section className="rounded-3xl border border-white/10 bg-black/60 p-6 font-mono text-xs text-white/80">
                {hasDifferences ? (
                  <div className="space-y-2">
                    {diffLines.map((line) => (
                      <div
                        key={`${line.kind}-${line.lineNumber}-${line.published ?? ""}-${line.draft ?? ""}`}
                        className={`grid grid-cols-[auto_1fr_1fr] gap-4 rounded-lg px-3 py-2 ${
                          line.kind === "same"
                            ? "bg-white/5"
                            : line.kind === "added"
                              ? "bg-emerald-500/20"
                              : line.kind === "removed"
                                ? "bg-rose-500/20"
                                : "bg-amber-500/20"
                        }`}
                      >
                        <span className="text-white/40">{line.lineNumber}</span>
                        <pre className="whitespace-pre-wrap text-white/80">{line.published ?? ""}</pre>
                        <pre className="whitespace-pre-wrap text-white/80">{line.draft ?? ""}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Draft and published markup are identical.</p>
                )}
              </section>
            ) : (
              <section className="space-y-4">
                <article className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white">
                  <header className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold capitalize">{viewMode} snapshot</h3>
                    <span className="text-xs text-white/60">
                      {viewMode === "draft" ? "Draft" : "Published"} • {summarizeBlocks(snapshotForView)}
                    </span>
                  </header>
                  <div
                    className="prose prose-invert mt-6 max-w-none"
                    dangerouslySetInnerHTML={{ __html: snapshotForView?.markup ?? "" }}
                  />
                </article>
                <article className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-6 text-white/70">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">Fallback guidance</h4>
                  <p className="mt-3 text-sm">
                    Use this snapshot to validate hero, metrics, and marketing block fallbacks. Adjust Payload fixtures or update
                    normalizer heuristics when sections are missing or diverge from expectations.
                  </p>
                </article>
              </section>
            )}

            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/80">
              <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Regression notes</h3>
                  <p className="text-sm text-white/60">
                    Capture triage context for <span className="font-semibold">{activeGroup.route}</span> on
                    {" "}
                    {formatDateTime(activeEntry.generatedAt)}.
                  </p>
                </div>
                <span className="text-xs uppercase tracking-[0.3em] text-white/50">
                  {routeNotes.length} note{routeNotes.length === 1 ? "" : "s"}
                </span>
              </header>

              <div className="mt-4 space-y-4">
                {routeNotes.length ? (
                  <ul className="space-y-3">
                    {routeNotes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/80"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                            severityStyles[note.severity]
                          }`}>
                            {severityLabels[note.severity]}
                            {note.author ? <span className="text-white/70">· {note.author}</span> : null}
                          </span>
                          <span className="text-xs uppercase tracking-[0.2em] text-white/50">
                            {formatDateTime(note.createdAt)}
                          </span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{note.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-white/60">No notes captured yet for this snapshot.</p>
                )}

                <form className="space-y-3" onSubmit={handleSubmitNote}>
                  {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                  <textarea
                    className="min-h-[96px] w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                    placeholder="Document diff triage, fallback adjustments, or QA actions"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    required
                  />
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                        Severity
                        <select
                          className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                          value={noteSeverity}
                          onChange={(event) =>
                            setNoteSeverity(event.target.value as MarketingPreviewTriageNoteSeverity)
                          }
                        >
                          {Object.entries(severityLabels).map(([value, label]) => (
                            <option key={value} value={value} className="text-black">
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input
                        className="rounded-full border border-white/10 bg-black/40 px-4 py-1 text-xs text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                        placeholder="Author (optional)"
                        value={noteAuthor}
                        onChange={(event) => setNoteAuthor(event.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-full border border-white/40 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-white"
                      disabled={isSaving || !noteBody.trim()}
                    >
                      {isSaving ? "Saving…" : "Add note"}
                    </button>
                  </div>
                </form>
              </div>
            </section>
          </>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center text-white/70">
            <p>No marketing preview snapshots were loaded. Ensure deterministic snapshot generation is configured.</p>
          </div>
        )}
      </div>
    </section>
  );
}
