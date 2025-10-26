"use client";

// meta: component: PreviewWorkbench
// meta: feature: marketing-preview-cockpit

import { useMemo, useState } from "react";

import type { MarketingPreviewSnapshot } from "@/server/cms/preview";

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

const groupSnapshots = (
  published: MarketingPreviewSnapshot[],
  draft: MarketingPreviewSnapshot[]
) => {
  const groups = new Map<string, { route: string; published?: MarketingPreviewSnapshot; draft?: MarketingPreviewSnapshot }>();

  for (const snapshot of published) {
    groups.set(snapshot.route, {
      route: snapshot.route,
      published: snapshot
    });
  }

  for (const snapshot of draft) {
    const existing = groups.get(snapshot.route);
    if (existing) {
      existing.draft = snapshot;
      continue;
    }
    groups.set(snapshot.route, {
      route: snapshot.route,
      draft: snapshot
    });
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

type PreviewWorkbenchProps = {
  published: MarketingPreviewSnapshot[];
  draft: MarketingPreviewSnapshot[];
  generatedAt: string;
};

export function PreviewWorkbench({ published, draft, generatedAt }: PreviewWorkbenchProps) {
  const grouped = useMemo(() => groupSnapshots(published, draft), [published, draft]);
  const [selectedRoute, setSelectedRoute] = useState(grouped[0]?.route ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("diff");

  const active = useMemo(() => grouped.find((group) => group.route === selectedRoute), [grouped, selectedRoute]);
  const diffLines = useMemo(
    () => computeDiff(active?.published?.markup, active?.draft?.markup),
    [active?.published?.markup, active?.draft?.markup]
  );

  const snapshotForView = viewMode === "draft" ? active?.draft : active?.published;
  const hasDifferences = diffLines.some((line) => line.kind !== "same");

  return (
    <section className="grid gap-8 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Snapshots</p>
          <p className="mt-2 text-sm text-white/70">Generated {formatDateTime(generatedAt)}</p>
        </div>

        <nav className="flex flex-col gap-3">
          {grouped.map((group) => {
            const isActive = group.route === selectedRoute;
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
                <p className="text-sm font-semibold">{group.route}</p>
                <p className="mt-1 text-xs text-white/60">{summarizeBlocks(group.published ?? group.draft)}</p>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="space-y-6">
        {active ? (
          <>
            <header className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Route</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{active.route}</h2>
                  <p className="mt-2 text-sm text-white/70">
                    Draft hero: {active.draft?.hero?.headline ?? "–"} • Published hero: {active.published?.hero?.headline ?? "–"}
                  </p>
                  <p className="mt-1 text-sm text-white/60">
                    Draft metrics: {summarizeMetrics(active.draft)}
                  </p>
                  <p className="mt-1 text-sm text-white/60">
                    Published metrics: {summarizeMetrics(active.published)}
                  </p>
                </div>

                <div className="flex flex-col items-start gap-2 md:items-end">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    hasDifferences ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/20 text-emerald-200"
                  }`}>
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

            {viewMode === "diff" ? (
              <section className="rounded-3xl border border-white/10 bg-black/60 p-6 font-mono text-xs text-white/80">
                {hasDifferences ? (
                  <div className="space-y-2">
                    {diffLines.map((line) => (
                      <div
                        key={line.lineNumber}
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
