"use client";

// meta: component: BlockDiagnosticsPanel
// meta: feature: marketing-preview-diagnostics

import { useCallback, useMemo, useState } from "react";

import type {
  LiveDiagnosticsLedgerEntry,
  LiveDiagnosticsSection,
  LiveValidationBlock,
  LiveValidationEntry
} from "./useLivePreview";

const statusStyles = {
  ok: "bg-emerald-500/20 text-emerald-100",
  warn: "bg-amber-500/20 text-amber-100",
  error: "bg-rose-500/20 text-rose-100"
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
  validation
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
            docId: validation?.docId
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
    [route, summary, validation?.collection, validation?.docId]
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
        </div>
      </header>

      {actionStatus ? (
        <p
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            actionStatus.kind === "success" ? "bg-emerald-500/10 text-emerald-100" : "bg-rose-500/10 text-rose-100"
          }`}
        >
          {actionStatus.message}
        </p>
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
          disabled={pendingAction !== null}
        >
          {pendingAction === "reset" ? "Resetting…" : "Reset fallbacks"}
        </button>
      </div>

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
                        <li key={`${block.key}-hint-${hintIndex}`}>• {hint}</li>
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
                      disabled={pendingAction !== null}
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
