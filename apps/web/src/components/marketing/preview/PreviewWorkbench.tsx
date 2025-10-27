"use client";

// meta: component: PreviewWorkbench
// meta: feature: marketing-preview-cockpit

import { useEffect, useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type {
  MarketingPreviewSnapshot,
  MarketingPreviewTimelineEntry
} from "@/server/cms/preview";
import type {
  MarketingPreviewTriageNote,
  MarketingPreviewTriageNoteSeverity
} from "@/server/cms/preview/notes";
import {
  useLivePreview,
  type LivePreviewConnectionState,
  type LiveValidationEntry
} from "./useLivePreview";
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
    timelineEntries,
    connectionState,
    validationQueue,
    clearValidationQueue,
    routeValidation,
    routeDiagnostics
  } = useLivePreview({ current, history });
  const [selectedEntryId, setSelectedEntryId] = useState(timelineEntries[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [localNotes, setLocalNotes] = useState<MarketingPreviewTriageNote[]>(notes);
  const [noteBody, setNoteBody] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("");
  const [noteSeverity, setNoteSeverity] = useState<MarketingPreviewTriageNoteSeverity>("info");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

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

  const routeGroups = useMemo(() => buildRouteGroups(activeEntry ?? undefined), [activeEntry]);
  const [selectedRoute, setSelectedRoute] = useState(routeGroups[0]?.route ?? "");

  useEffect(() => {
    if (!routeGroups.length) {
      setSelectedRoute("");
      return;
    }
    setSelectedRoute((currentRoute) => {
      if (routeGroups.some((group) => group.route === currentRoute)) {
        return currentRoute;
      }
      return routeGroups[0]?.route ?? "";
    });
  }, [routeGroups]);

  useEffect(() => {
    setViewMode("diff");
  }, [selectedEntryId]);

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
  const diagnosticsLedger = activeGroup ? routeDiagnostics[activeGroup.route] : undefined;
  const activeDiagnostics = diagnosticsLedger?.latest;
  const diagnosticsHistory = diagnosticsLedger?.history ?? [];
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
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Timeline</p>
          <p className="mt-1 text-sm text-white/70">
            {timelineEntries.length} capture{timelineEntries.length === 1 ? "" : "s"} · {changedRouteCount}/
            {totalRoutes} active diffs
          </p>
          <span
            className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${connectionBadgeStyles[connectionState]}`}
          >
            {connectionBadgeLabels[connectionState]}
          </span>
          <div className="mt-4 flex flex-col gap-2">
            {timelineEntries.map((entry, index) => {
              const isActive = entry.id === activeEntry?.id;
              const diffCount = entry.routes.filter((route) => route.diffDetected).length;
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
                    {diffCount} diff{diffCount === 1 ? "" : "s"} · {entry.routes.length} routes
                  </p>
                </button>
              );
            })}
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
                </div>
              </div>
            </header>

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
                                <li key={`${activeValidation.id}-${blockKey}-hint-${hintIndex}`}>• {hint}</li>
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
