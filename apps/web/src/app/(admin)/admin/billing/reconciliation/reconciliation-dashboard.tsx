"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  ReconciliationDashboard,
  ReconciliationDiscrepancy,
  ReconciliationRun,
  ReconciliationStagingEntry,
} from "@/server/billing/types";

const runStatusOptions = [
  { label: "All runs", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Running", value: "running" },
];

const stagingStatusOptions = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Requeued", value: "requeued" },
  { label: "Triaged", value: "triaged" },
  { label: "Resolved", value: "resolved" },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const toTitleCase = (value: string) =>
  value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

type DashboardProps = {
  dashboard: ReconciliationDashboard;
};

type ActionState = Record<string, string>;

type StagingNotes = Record<string, string>;

export function ReconciliationDashboardView({ dashboard }: DashboardProps) {
  const router = useRouter();
  const [runFilter, setRunFilter] = useState<string>("all");
  const [discrepancyFilter, setDiscrepancyFilter] = useState<string>("all");
  const [discrepancyTypeFilter, setDiscrepancyTypeFilter] = useState<string>("all");
  const [stagingFilter, setStagingFilter] = useState<string>("pending");
  const [notes, setNotes] = useState<StagingNotes>({});
  const [actionState, setActionState] = useState<ActionState>({});
  const [isPending, startTransition] = useTransition();

  const availableDiscrepancyStatuses = useMemo(() => {
    const statuses = new Set(dashboard.discrepancies.map((item) => item.status.toLowerCase()));
    return ["all", ...Array.from(statuses)];
  }, [dashboard.discrepancies]);

  const availableDiscrepancyTypes = useMemo(() => {
    const typeSet = new Set(
      dashboard.discrepancies.map((item) => item.discrepancyType.toLowerCase()),
    );
    return ["all", ...Array.from(typeSet)];
  }, [dashboard.discrepancies]);

  const filteredRuns = useMemo(() => {
    if (runFilter === "all") {
      return dashboard.runs;
    }
    return dashboard.runs.filter((run) => run.status.toLowerCase() === runFilter);
  }, [dashboard.runs, runFilter]);

  const filteredDiscrepancies = useMemo(() => {
    return dashboard.discrepancies.filter((item) => {
      const statusMatches =
        discrepancyFilter === "all" || item.status.toLowerCase() === discrepancyFilter.toLowerCase();
      const typeMatches =
        discrepancyTypeFilter === "all" ||
        item.discrepancyType.toLowerCase() === discrepancyTypeFilter.toLowerCase();
      return statusMatches && typeMatches;
    });
  }, [dashboard.discrepancies, discrepancyFilter, discrepancyTypeFilter]);

  const filteredStaging = useMemo(() => {
    if (stagingFilter === "all") {
      return dashboard.staging;
    }
    return dashboard.staging.filter((item) => item.status.toLowerCase() === stagingFilter);
  }, [dashboard.staging, stagingFilter]);

  const openDiscrepancies = dashboard.discrepancies.filter(
    (item) => item.status.toLowerCase() === "open",
  ).length;

  const failedRuns = dashboard.runs.filter((run) => run.status === "failed");
  const latestFailure = failedRuns.length > 0 ? failedRuns[0] : null;

  const handleTriage = (entry: ReconciliationStagingEntry, status: string) => {
    const note = notes[entry.id] ?? entry.triageNote ?? "";
    startTransition(async () => {
      setActionState((prev) => ({ ...prev, [entry.id]: "Saving triage..." }));
      try {
        const response = await fetch(
          `/api/billing/reconciliation/staging/${entry.id}/triage`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ status, triageNote: note || null }),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Unable to triage entry." }));
          setActionState((prev) => ({ ...prev, [entry.id]: body.error ?? "Unable to triage entry." }));
          return;
        }
        setActionState((prev) => ({ ...prev, [entry.id]: "Triage saved" }));
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to triage entry.";
        setActionState((prev) => ({ ...prev, [entry.id]: message }));
      }
    });
  };

  const handleRequeue = (entry: ReconciliationStagingEntry) => {
    const note = notes[entry.id] ?? entry.triageNote ?? "";
    startTransition(async () => {
      setActionState((prev) => ({ ...prev, [entry.id]: "Requeuing..." }));
      try {
        const response = await fetch(
          `/api/billing/reconciliation/staging/${entry.id}/requeue`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ triageNote: note || null }),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Unable to requeue entry." }));
          setActionState((prev) => ({ ...prev, [entry.id]: body.error ?? "Unable to requeue entry." }));
          return;
        }
        setActionState((prev) => ({ ...prev, [entry.id]: "Entry requeued" }));
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to requeue entry.";
        setActionState((prev) => ({ ...prev, [entry.id]: message }));
      }
    });
  };

  const updateNote = (entryId: string, value: string) => {
    setNotes((prev) => ({ ...prev, [entryId]: value }));
  };

  return (
    <div className="flex flex-col gap-10">
      <section
        className="grid gap-4 md:grid-cols-4"
        data-testid="reconciliation-summary"
        aria-live="polite"
      >
        <SummaryCard title="Staging backlog" value={dashboard.stagingBacklog} tone="bg-blue-500/10" />
        <SummaryCard title="Open discrepancies" value={openDiscrepancies} tone="bg-amber-500/10" />
        <SummaryCard title="Failed runs" value={failedRuns.length} tone="bg-rose-500/10" />
        <SummaryCard
          title="Last failure"
          value={latestFailure ? formatFailure(latestFailure) : "None recorded"}
          tone="bg-purple-500/10"
          emphasize
        />
      </section>

      <section className="space-y-4" data-testid="reconciliation-run-history">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">Run history</h2>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <span>Status filter</span>
            <select
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              value={runFilter}
              onChange={(event) => setRunFilter(event.target.value)}
            >
              {runStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-5 py-3 font-semibold">Started</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Totals</th>
                <th className="px-5 py-3 font-semibold">Discrepancies</th>
                <th className="px-5 py-3 font-semibold">Failure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {filteredRuns.length === 0 ? (
                <tr>
                  <td className="px-5 py-4 text-center text-white/60" colSpan={5}>
                    No reconciliation runs found.
                  </td>
                </tr>
              ) : (
                filteredRuns.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4" data-testid="reconciliation-staging-table">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">Staging triage</h2>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <span>Status filter</span>
            <select
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              value={stagingFilter}
              onChange={(event) => setStagingFilter(event.target.value)}
            >
              {stagingStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-5 py-3 font-semibold">Transaction</th>
                <th className="px-5 py-3 font-semibold">Reason</th>
                <th className="px-5 py-3 font-semibold">Observed</th>
                <th className="px-5 py-3 font-semibold">Notes</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {filteredStaging.length === 0 ? (
                <tr>
                  <td className="px-5 py-4 text-center text-white/60" colSpan={5}>
                    No staging entries match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredStaging.map((entry) => (
                  <tr
                    key={entry.id}
                    className="align-top"
                    data-testid="staging-row"
                    data-staging-id={entry.id}
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-white">{entry.transactionId}</div>
                      <div className="text-xs text-white/60">{entry.processor}</div>
                      <div className="text-xs text-white/60">
                        Workspace hint: {entry.workspaceHint ?? "Unknown"}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-sm text-white">{entry.reason}</div>
                      <div className="text-xs text-white/60">
                        Status: {entry.status}
                      </div>
                      <div className="text-xs text-white/60">
                        Requeues: {entry.requeueCount}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-white/70">
                      <div>First: {formatDate(entry.firstObservedAt)}</div>
                      <div>Last: {formatDate(entry.lastObservedAt)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <textarea
                        className="w-full rounded-lg border border-white/10 bg-black/40 p-2 text-sm text-white"
                        rows={3}
                        placeholder="Add triage context"
                        value={notes[entry.id] ?? entry.triageNote ?? ""}
                        onChange={(event) => updateNote(entry.id, event.target.value)}
                        data-testid="triage-note-input"
                      />
                      {actionState[entry.id] && (
                        <p className="mt-2 text-xs text-white/60">{actionState[entry.id]}</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"
                          onClick={() => handleTriage(entry, "triaged")}
                          disabled={isPending}
                          data-testid="triage-action"
                          data-action="triaged"
                        >
                          Mark triaged
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200"
                          onClick={() => handleTriage(entry, "resolved")}
                          disabled={isPending}
                          data-testid="triage-action"
                          data-action="resolved"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200"
                          onClick={() => handleRequeue(entry)}
                          disabled={isPending}
                          data-testid="requeue-action"
                        >
                          Requeue
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4" data-testid="reconciliation-discrepancies">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">Discrepancy log</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <span>Status filter</span>
              <select
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={discrepancyFilter}
                onChange={(event) => setDiscrepancyFilter(event.target.value)}
                data-testid="discrepancy-status-filter"
              >
                {availableDiscrepancyStatuses.map((status) => (
                  <option key={status} value={status}>
                    {toTitleCase(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <span>Type filter</span>
              <select
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={discrepancyTypeFilter}
                onChange={(event) => setDiscrepancyTypeFilter(event.target.value)}
                data-testid="discrepancy-type-filter"
              >
                {availableDiscrepancyTypes.map((type) => (
                  <option key={type} value={type}>
                    {toTitleCase(type)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-5 py-3 font-semibold">Summary</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Playbook</th>
                <th className="px-5 py-3 font-semibold">Observed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {filteredDiscrepancies.length === 0 ? (
                <tr>
                  <td className="px-5 py-4 text-center text-white/60" colSpan={6}>
                    No discrepancies match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredDiscrepancies.map((discrepancy) => (
                  <DiscrepancyRow key={discrepancy.id} discrepancy={discrepancy} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  tone,
  emphasize = false,
}: {
  title: string;
  value: string | number;
  tone: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-3xl border border-white/10 ${tone} p-6 backdrop-blur`}>
      <p className="text-xs uppercase tracking-[0.3em] text-white/60">{title}</p>
      <p className={`mt-3 text-2xl font-semibold ${emphasize ? "text-white" : "text-white/80"}`}>
        {typeof value === "number" ? numberFormatter.format(value) : value}
      </p>
    </div>
  );
}

function RunRow({ run }: { run: ReconciliationRun }) {
  return (
    <tr className="align-top">
      <td className="px-5 py-4 text-white/80">{formatDate(run.startedAt)}</td>
      <td className="px-5 py-4 text-white">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(run.status)}`}>
          {run.status}
        </span>
      </td>
      <td className="px-5 py-4 text-white/70">
        <div>Total: {run.totalTransactions}</div>
        <div>Matched: {run.matchedTransactions}</div>
        <div>Staged: {run.metrics?.staged ?? 0}</div>
      </td>
      <td className="px-5 py-4 text-white/70">
        <div>Discrepancies: {run.discrepancyCount}</div>
        <div>Disputes: {run.metrics?.disputes ?? 0}</div>
      </td>
      <td className="px-5 py-4 text-sm text-rose-200">
        {run.failure ? (
          <div className="space-y-1">
            <div className="font-semibold">{run.failure.error}</div>
            <div className="text-xs text-white/60">Staged at failure: {run.failure.staged}</div>
          </div>
        ) : (
          <div className="text-white/60">—</div>
        )}
      </td>
    </tr>
  );
}

function DiscrepancyRow({ discrepancy }: { discrepancy: ReconciliationDiscrepancy }) {
  return (
    <tr className="align-top">
      <td className="px-5 py-4 text-white">
        <div className="font-semibold">{discrepancy.summary ?? "Missing summary"}</div>
        {discrepancy.transactionId && (
          <div className="text-xs text-white/60">Txn: {discrepancy.transactionId}</div>
        )}
        {discrepancy.invoiceId && (
          <div className="text-xs text-white/60">Invoice: {discrepancy.invoiceId}</div>
        )}
      </td>
      <td className="px-5 py-4 text-white/70">{discrepancy.discrepancyType}</td>
      <td className="px-5 py-4 text-white/70">{discrepancy.status}</td>
      <td className="px-5 py-4 text-white/70">
        {typeof discrepancy.amountDelta === "number" ? `€${discrepancy.amountDelta.toFixed(2)}` : "—"}
      </td>
      <td className="px-5 py-4 text-white/70">
        {discrepancy.playbook ? (
          <div className="space-y-2 text-xs text-white/60">
            <ul className="list-disc space-y-1 pl-4">
              {discrepancy.playbook.recommendedActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
            <div className="space-y-1">
              {typeof discrepancy.playbook.autoResolveThreshold === "number" && (
                <div>
                  Auto-resolve ≤ {formatAmount(discrepancy.playbook.autoResolveThreshold)}
                </div>
              )}
              {typeof discrepancy.playbook.escalationAfterHours === "number" && (
                <div>Escalate after {discrepancy.playbook.escalationAfterHours}h</div>
              )}
              {discrepancy.playbook.notes && <div>{discrepancy.playbook.notes}</div>}
            </div>
          </div>
        ) : (
          <span className="text-xs text-white/50">No playbook</span>
        )}
      </td>
      <td className="px-5 py-4 text-white/70">{formatDate(discrepancy.createdAt)}</td>
    </tr>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return dateFormatter.format(new Date(value));
}

function formatFailure(run: ReconciliationRun): string {
  if (!run.failure) {
    return "None";
  }
  return `${run.failure.error} (${formatDate(run.startedAt)})`;
}

function formatAmount(value: number): string {
  return `€${value.toFixed(2)}`;
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "completed":
      return "border border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
    case "running":
      return "border border-sky-400/40 bg-sky-500/10 text-sky-200";
    case "failed":
      return "border border-rose-400/40 bg-rose-500/10 text-rose-200";
    default:
      return "border border-white/10 bg-white/10 text-white/70";
  }
}
