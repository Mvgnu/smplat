"use client";

// meta: component: BlockDiagnosticsPanel
// meta: feature: marketing-preview-diagnostics

import { useCallback, useMemo, useState } from "react";

import type {
  LiveDiagnosticsLedgerEntry,
  LiveDiagnosticsSection,
  LiveValidationBlock,
  LiveValidationEntry,
  LiveBlockDiff,
  LiveBlockDiffStatus,
  LiveBlockDiffCluster,
  LivePreviewVariantDescriptor,
  RouteDiagnosticsAggregatedState,
  RouteDiagnosticsVariantState
} from "./useLivePreview";
import {
  getPlaybooksByCategory,
  type RemediationPlaybook,
  type RemediationCategory
} from "@/shared/marketing/remediation";

const statusStyles = {
  ok: "bg-emerald-500/20 text-emerald-100",
  warn: "bg-amber-500/20 text-amber-100",
  error: "bg-rose-500/20 text-rose-100"
};

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

const panelDiffOrder: LiveBlockDiffStatus[] = [
  "regressed",
  "improved",
  "added",
  "removed"
];

const severityHeatClasses: Record<number, string> = {
  [-1]: "bg-slate-500/40",
  0: "bg-emerald-500/30",
  1: "bg-amber-500/60",
  2: "bg-rose-500/60"
};

const buildSeverityHeatmap = (cluster: LiveBlockDiffCluster) => {
  const samples = cluster.severityHistory.slice(0, 8);
  if (samples.length === 0) {
    return (
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">No history</span>
    );
  }
  return (
    <div className="flex h-2 w-full gap-1">
      {samples.map((severity, index) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={`${cluster.blockKey}-spark-${index}`}
          className={`flex-1 rounded ${severityHeatClasses[severity] ?? "bg-white/10"}`}
        />
      ))}
    </div>
  );
};

const classifyBlockStatus = (block: LiveValidationBlock): "ok" | "warn" | "error" => {
  if (!block.valid || block.errors.length > 0) {
    return "error";
  }
  if (block.warnings.length > 0) {
    return "warn";
  }
  return "ok";
};

const formatDelta = (value: number) => {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
};

const buildPayloadPath = (collection?: string, docId?: string | null) => {
  if (!collection || !docId) return null;
  return `/admin/collections/${collection}/${docId}`;
};

type BlockDiagnosticsPanelProps = {
  route: string;
  entry?: LiveDiagnosticsLedgerEntry;
  history?: LiveDiagnosticsLedgerEntry[];
  validation?: LiveValidationEntry;
  variantState?: RouteDiagnosticsVariantState;
  aggregated?: RouteDiagnosticsAggregatedState;
  availableVariants?: LivePreviewVariantDescriptor[];
  selectedVariantKey?: string;
  remediationLocked?: boolean;
  remediationGuardReasons?: string[];
};

type ActionStatus = { kind: "success" | "error"; message: string } | null;

const normalizeSections = (
  sections: LiveDiagnosticsSection[] | undefined,
  warnings: string[]
): LiveDiagnosticsSection[] => {
  if (!sections?.length && warnings.length) {
    return [
      {
        label: "Lexical normalization",
        index: -1,
        warnings,
        blockCount: 0,
        invalidBlocks: 0
      }
    ];
  }
  return sections ?? [];
};

export function BlockDiagnosticsPanel({
  route,
  entry,
  history = [],
  validation,
  variantState,
  aggregated,
  availableVariants = [],
  selectedVariantKey,
  remediationLocked = false,
  remediationGuardReasons = []
}: BlockDiagnosticsPanelProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);

  const summary = useMemo(
    () => entry?.summary ?? validation?.diagnostics.summary,
    [entry?.summary, validation?.diagnostics.summary]
  );

  const normalizationWarnings = useMemo(
    () => entry?.normalizationWarnings ?? validation?.diagnostics.normalizationWarnings ?? [],
    [entry?.normalizationWarnings, validation?.diagnostics.normalizationWarnings]
  );

  const sections = useMemo(
    () => normalizeSections(entry?.sections ?? validation?.diagnostics.sections, normalizationWarnings),
    [entry?.sections, validation?.diagnostics.sections, normalizationWarnings]
  );

  const blocks = useMemo(
    () => validation?.blocks ?? entry?.blocks ?? [],
    [validation?.blocks, entry?.blocks]
  );

  const payloadPath = useMemo(
    () => buildPayloadPath(validation?.collection, validation?.docId),
    [validation?.collection, validation?.docId]
  );

  const variantLabel = useMemo(() => {
    if (variantState?.descriptor?.label) {
      return variantState.descriptor.label;
    }
    const fallback = availableVariants.find((variant) => variant.key === selectedVariantKey);
    return fallback?.label ?? "Baseline";
  }, [variantState?.descriptor?.label, availableVariants, selectedVariantKey]);

  const diffTotals = useMemo(() => {
    const base = panelDiffOrder.reduce<Record<LiveBlockDiffStatus, number>>((accumulator, status) => {
      accumulator[status] = 0;
      return accumulator;
    }, {});
    if (!variantState?.diffSummary) {
      return base;
    }
    return { ...base, ...variantState.diffSummary };
  }, [variantState?.diffSummary]);

  const fingerprintEntries = useMemo(() => {
    const entries = Object.values(variantState?.fingerprints ?? {});
    return entries.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 12);
  }, [variantState?.fingerprints]);

  const diffClusters = useMemo(() => {
    const entries = Object.values(variantState?.diffClusters ?? {});
    return entries
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 8);
  }, [variantState?.diffClusters]);

  const regressionDiffs = useMemo(
    () => (entry?.blockDiffs ?? []).filter((diff) => diff.status === "regressed"),
    [entry?.blockDiffs]
  );

  const sinceLastGreen = variantState?.sinceLastGreen;
  const driftSnapshot = selectedVariantKey ? aggregated?.driftByVariant[selectedVariantKey] : undefined;
  const remediationPlaybooks = useMemo(() => {
    const categoryMap = new Map<RemediationCategory, Set<string>>();
    blocks.forEach((block) => {
      block.recoveryHints.forEach((hint) => {
        const category = hint.category as RemediationCategory;
        const fields = categoryMap.get(category) ?? new Set<string>();
        if (hint.fieldPath) {
          fields.add(hint.fieldPath);
        }
        categoryMap.set(category, fields);
      });
    });

    const cards: Array<RemediationPlaybook & { matchedFields: string[] }> = [];
    categoryMap.forEach((fields, category) => {
      const playbooks = getPlaybooksByCategory(category);
      playbooks.forEach((playbook) => {
        cards.push({ ...playbook, matchedFields: Array.from(fields) });
      });
    });

    return cards;
  }, [blocks]);

  const handleFallbackAction = useCallback(
    async (action: "reset" | "prioritize", fingerprint?: string, pendingKey?: string) => {
      const nextPending = pendingKey ?? `${action}-${fingerprint ?? "global"}`;
      setPendingAction(nextPending);
      setActionStatus(null);
      try {
        const response = await fetch("/api/marketing-preview/fallbacks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            route,
            action,
            fingerprint,
            summary,
            collection: validation?.collection,
            docId: validation?.docId,
            generatedAt: entry?.receivedAt ?? validation?.receivedAt ?? null
          })
        });
        if (!response.ok) {
          throw new Error("Request failed");
        }
        const result = (await response.json()) as { acknowledged?: boolean };
        if (!result.acknowledged) {
          throw new Error("Fallback action rejected");
        }
        setActionStatus({
          kind: "success",
          message: action === "reset" ? "Fallback ordering reset." : "Fallback reprioritized."
        });
      } catch {
        setActionStatus({ kind: "error", message: "Unable to update fallback configuration." });
      } finally {
        setPendingAction(null);
      }
    },
    [route, summary, validation?.collection, validation?.docId, entry?.receivedAt, validation?.receivedAt]
  );

  const handleCopyFingerprint = useCallback(
    async (fingerprint: string) => {
      if (typeof navigator === "undefined") return;
      try {
        await navigator.clipboard.writeText(fingerprint);
        setActionStatus({ kind: "success", message: "Block fingerprint copied." });
      } catch {
        setActionStatus({ kind: "error", message: "Unable to copy fingerprint." });
      }
    },
    []
  );

  const handleCopyPayloadPath = useCallback(async () => {
    if (!payloadPath || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(payloadPath);
      setActionStatus({ kind: "success", message: "Payload path copied to clipboard." });
    } catch {
      setActionStatus({ kind: "error", message: "Failed to copy Payload path." });
    }
  }, [payloadPath]);

  const invalidDelta = entry?.delta.invalidBlocks ?? 0;
  const warningDelta = entry?.delta.warningBlocks ?? 0;

  return (
    <section className="rounded-3xl border border-white/10 bg-black/40 p-6 text-white/80">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Block diagnostics</h3>
          <p className="text-sm text-white/60">Route {route}</p>
          <p className="text-xs text-white/50">Variant {variantLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-full bg-white/10 px-3 py-1 uppercase tracking-[0.2em] text-white/70">
            Total {summary?.totalBlocks ?? 0}
          </span>
          <span className="rounded-full bg-rose-500/20 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-rose-100">
            {summary?.invalidBlocks ?? 0} invalid ({formatDelta(invalidDelta)})
          </span>
          <span className="rounded-full bg-amber-500/20 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-amber-100">
            {summary?.warningBlocks ?? 0} warnings ({formatDelta(warningDelta)})
          </span>
          {driftSnapshot ? (
            <span className="rounded-full bg-sky-500/20 px-3 py-1 font-semibold uppercase tracking-[0.2em] text-sky-100">
              Drift Δ invalid {driftSnapshot.invalidDelta} · warnings {driftSnapshot.warningDelta}
            </span>
          ) : null}
          {sinceLastGreen ? (
            <span className="rounded-full bg-white/10 px-3 py-1 uppercase tracking-[0.2em] text-white/60">
              {sinceLastGreen.steps === 0
                ? "Variant healthy"
                : `Last green ${sinceLastGreen.steps} capture${sinceLastGreen.steps === 1 ? "" : "s"} ago`}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {panelDiffOrder.map((status) => (
          <div
            key={status}
            className={`rounded-2xl border border-white/10 px-4 py-3 text-sm ${diffStatusStyles[status]}`}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">{diffStatusLabels[status]}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{diffTotals[status] ?? 0}</p>
          </div>
        ))}
      </div>

      {diffClusters.length ? (
        <div className="mt-6 space-y-2">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Diff clusters</h4>
          <ul className="space-y-2 text-xs text-white/70">
            {diffClusters.map((cluster) => (
              <li
                key={cluster.blockKey}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{cluster.blockKind ?? "Block"}</p>
                    <p className="text-[11px] text-white/40">{cluster.blockKey}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                      diffStatusStyles[cluster.statusHistory[0] ?? "steady"]
                    }`}
                  >
                    {diffStatusLabels[cluster.statusHistory[0] ?? "steady"]}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
                  <span>Regressions {cluster.totals.regressed ?? 0}</span>
                  <span>Improvements {cluster.totals.improved ?? 0}</span>
                  <span>Run {cluster.regressionRun}</span>
                </div>
                <div className="mt-3">{buildSeverityHeatmap(cluster)}</div>
                <p className="mt-2 text-[10px] text-white/40">
                  Last seen {new Date(cluster.lastSeenAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionStatus ? (
        <p
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            actionStatus.kind === "success" ? "bg-emerald-500/10 text-emerald-100" : "bg-rose-500/10 text-rose-100"
          }`}
        >
          {actionStatus.message}
        </p>
      ) : null}

      {fingerprintEntries.length ? (
        <div className="mt-6 space-y-2">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Fingerprint ledger</h4>
          <ul className="space-y-1 text-[11px] text-white/60">
            {fingerprintEntries.map((record) => (
              <li key={record.blockKey} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white/80">{record.blockKind ?? "Block"}</span>
                <span className="text-white/40">{record.blockKey}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${diffStatusStyles[record.status]}`}>
                  {diffStatusLabels[record.status]}
                </span>
                <span className="text-white/30">{new Date(record.lastSeenAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {regressionDiffs.length ? (
        <div className="mt-6 space-y-2">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Regression diffs</h4>
          <ul className="space-y-1 text-xs text-white/70">
            {regressionDiffs.map((diff) => (
              <li key={`${diff.blockKey}-${diff.traceHash}`} className="rounded-2xl border border-white/10 bg-rose-500/10 px-3 py-2">
                <span className="font-semibold text-white">{diff.blockKind ?? "Block"}</span>
                <span className="ml-2 text-white/60">{diff.blockKey}</span>
                <span className="ml-2 text-rose-200">
                  Severity {diff.previousSeverity ?? 0} → {diff.severity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {aggregated?.variantKeys.length ? (
        <div className="mt-6 space-y-1">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Variant drift overview</h4>
          <ul className="space-y-1 text-[11px] text-white/60">
            {aggregated.variantKeys.map((key) => {
              const descriptor = availableVariants.find((variant) => variant.key === key);
              const drift = aggregated.driftByVariant[key];
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <span className="font-semibold text-white/80">{descriptor?.label ?? key}</span>
                  <span className="text-white/50">Δ invalid {drift?.invalidDelta ?? 0}</span>
                  <span className="text-white/50">Δ warnings {drift?.warningDelta ?? 0}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {remediationPlaybooks.length ? (
        <div className="mt-6 space-y-3">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Remediation playbooks</h4>
          <div className="space-y-2">
            {remediationPlaybooks.map((playbook) => (
              <details
                key={`${playbook.id}-${playbook.category}`}
                className="group rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-white">
                  <span className="font-semibold">{playbook.summary}</span>
                  <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-sky-100">
                    {playbook.category}
                  </span>
                </summary>
                <div className="mt-3 space-y-3 text-xs text-white/70">
                  {playbook.matchedFields.length ? (
                    <p className="text-[11px] text-white/50">
                      Target fields: {playbook.matchedFields.join(", ")}
                    </p>
                  ) : null}
                  <ol className="space-y-2">
                    {playbook.steps.map((step) => (
                      <li key={`${playbook.id}-${step.title}`} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                        <p className="font-semibold text-white">{step.title}</p>
                        <p className="mt-1 text-white/70">{step.description}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50">
                          {step.payloadPath ? <span>Payload: {step.payloadPath}</span> : null}
                          {step.fixtureSource ? <span>Fixture: {step.fixtureSource}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3 text-xs">
        {payloadPath ? (
          <button
            type="button"
            onClick={handleCopyPayloadPath}
            className="rounded-full border border-white/20 px-3 py-1 uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Copy Payload path
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => handleFallbackAction("reset", undefined, "reset")}
          className="rounded-full border border-white/20 px-3 py-1 uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
          disabled={pendingAction !== null || remediationLocked}
        >
          {pendingAction === "reset" ? "Resetting…" : "Reset fallbacks"}
        </button>
      </div>

      {remediationLocked && remediationGuardReasons.length ? (
        <ul className="mt-2 space-y-1 text-xs text-rose-100">
          {remediationGuardReasons.map((reason, index) => (
            <li key={`remediation-guard-${index}`}>• {reason}</li>
          ))}
        </ul>
      ) : null}

      {normalizationWarnings.length > 0 ? (
        <div className="mt-6 space-y-2">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Normalization warnings</h4>
          <ul className="space-y-1 text-xs text-amber-100">
            {normalizationWarnings.map((warning, index) => (
              <li key={`normalization-warning-${index}`}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="mt-6 space-y-3">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Sections</h4>
          <ul className="space-y-2 text-xs text-white/70">
            {sections.map((section) => (
              <li
                key={`${section.label}-${section.index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <span className="font-semibold text-white">{section.label}</span>
                <span className="text-white/60">
                  {section.blockCount} blocks · {section.invalidBlocks} invalid
                </span>
                {section.warnings.length ? (
                  <span className="text-amber-100">{section.warnings.join(" ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Blocks</h4>
        {blocks.length ? (
          <ul className="space-y-3">
            {blocks.map((block, index) => {
              const status = classifyBlockStatus(block);
              const statusLabel =
                status === "error" ? "Errors" : status === "warn" ? "Warnings" : "Healthy";
              const actionKey = `prioritize-${block.fingerprint ?? index}`;
              const showPromote = Boolean(block.fingerprint && (!block.valid || block.warnings.length || block.recoveryHints.length));
              return (
                <li key={`${block.key ?? index}-${block.fingerprint ?? index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{block.kind ?? "Unknown block"}</p>
                      <p className="text-xs text-white/50">Trace index {block.trace.lexicalIndex}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusStyles[status]}`}>
                      {statusLabel}
                    </span>
                  </div>
                  {block.errors.length ? (
                    <ul className="mt-3 space-y-1 text-xs text-rose-200">
                      {block.errors.map((error, errorIndex) => (
                        <li key={`${block.key}-error-${errorIndex}`}>• {error}</li>
                      ))}
                    </ul>
                  ) : null}
                  {block.warnings.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-amber-100">
                      {block.warnings.map((warning, warningIndex) => (
                        <li key={`${block.key}-warning-${warningIndex}`}>• {warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {block.recoveryHints.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-sky-100">
                      {block.recoveryHints.map((hint, hintIndex) => (
                        <li key={`${block.key}-hint-${hintIndex}`} className="flex flex-wrap items-center gap-2">
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
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
                    <span>Provenance: {block.trace.provenance}</span>
                    {block.fallback?.used ? <span>Fallback used</span> : null}
                    {block.trace.skipReason ? <span>Skipped</span> : null}
                  </div>
                  {showPromote ? (
                  <button
                    type="button"
                    onClick={() => handleFallbackAction("prioritize", block.fingerprint, actionKey)}
                    className="mt-3 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                    disabled={pendingAction !== null || remediationLocked}
                  >
                    {pendingAction === actionKey ? "Updating…" : "Promote fallback"}
                  </button>
                ) : null}
                  {block.fingerprint ? (
                    <button
                      type="button"
                      onClick={() => handleCopyFingerprint(block.fingerprint!)}
                      className="mt-2 rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60 transition hover:border-white/30 hover:text-white"
                    >
                      Copy fingerprint
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-white/60">No diagnostics available for this route yet.</p>
        )}
      </div>

      {history.length > 1 ? (
        <div className="mt-6 space-y-2">
          <h4 className="text-xs uppercase tracking-[0.3em] text-white/50">Recent diagnostics</h4>
          <ul className="space-y-1 text-[11px] text-white/50">
            {history.slice(1, 5).map((item) => (
              <li key={`ledger-${item.id}`}>
                {new Date(item.receivedAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short"
                })}
                {": "}
                {item.summary.invalidBlocks} invalid · {item.summary.warningBlocks} warnings
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
