"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  ProcessorReplayEvent,
  ProcessorReplayFilters,
  ProcessorReplayStatus,
} from "@/server/billing/types";

const statusOptions: Array<{ label: string; value: ProcessorReplayStatus | "all" }> = [
  { label: "All statuses", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Queued", value: "queued" },
  { label: "In progress", value: "in-progress" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type ReplayDashboardProps = {
  initialEvents: ProcessorReplayEvent[];
};

type ActionState = {
  message?: string;
  error?: string;
  requiresForce?: boolean;
};

type ReplayActionMap = Record<string, ActionState | undefined>;

type PendingState = Record<string, boolean>;

export function ReplayDashboardView({ initialEvents }: ReplayDashboardProps) {
  const router = useRouter();
  const [events, setEvents] = useState<ProcessorReplayEvent[]>(initialEvents);
  const [filters, setFilters] = useState<ProcessorReplayFilters>({ status: "queued" });
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [actions, setActions] = useState<ReplayActionMap>({});
  const [pending, setPending] = useState<PendingState>({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!searchTerm) {
      setFilters((prev) => {
        if (prev.correlationId) {
          const { correlationId: _ignored, ...rest } = prev;
          return rest;
        }
        return prev;
      });
    } else {
      setFilters((prev) => ({ ...prev, correlationId: searchTerm }));
    }
  }, [searchTerm]);

  const providerOptions = useMemo(() => {
    const providers = Array.from(new Set(events.map((event) => event.provider.toLowerCase())));
    providers.sort();
    return [{ label: "All providers", value: "all" as const }].concat(
      providers.map((provider) => ({
        label: provider.charAt(0).toUpperCase() + provider.slice(1),
        value: provider,
      })),
    );
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filters.provider && filters.provider !== "all") {
        if (event.provider.toLowerCase() !== filters.provider.toLowerCase()) {
          return false;
        }
      }

      if (filters.status && filters.status !== "all" && event.status !== filters.status) {
        return false;
      }

      if (filters.correlationId) {
        const normalized = filters.correlationId.trim().toLowerCase();
        if (
          normalized &&
          !event.correlationId?.toLowerCase().includes(normalized) &&
          !event.invoiceId?.toLowerCase().includes(normalized)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [events, filters]);

  const updateEvent = (event: ProcessorReplayEvent) => {
    setEvents((prev) => {
      const existing = prev.findIndex((item) => item.id === event.id);
      if (existing === -1) {
        return [event, ...prev];
      }
      const copy = [...prev];
      copy[existing] = event;
      return copy;
    });
  };

  const optimisticUpdate = (event: ProcessorReplayEvent) => {
    updateEvent({
      ...event,
      replayRequested: true,
      status: event.status === "succeeded" ? event.status : "queued",
      replayRequestedAt: new Date().toISOString(),
    });
  };

  const triggerReplay = (event: ProcessorReplayEvent, opts?: { force?: boolean }) => {
    startTransition(async () => {
      setPending((prev) => ({ ...prev, [event.id]: true }));
      setActions((prev) => ({ ...prev, [event.id]: { message: "Triggering replay..." } }));
      optimisticUpdate(event);

      try {
        const response = await fetch(`/api/billing/replays/${event.id}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ force: Boolean(opts?.force) }),
        });

        if (response.ok) {
          const body = (await response.json()) as { event: ProcessorReplayEvent };
          updateEvent(body.event);
          setActions((prev) => ({
            ...prev,
            [event.id]: { message: opts?.force ? "Force replay queued" : "Replay queued" },
          }));
          router.refresh();
        } else if (response.status === 409) {
          const body = (await response.json().catch(() => ({ error: "Replay limit reached" }))) as {
            error?: string;
          };
          setActions((prev) => ({
            ...prev,
            [event.id]: {
              error: body.error ?? "Replay limit reached",
              requiresForce: true,
            },
          }));
        } else {
          const body = (await response.json().catch(() => ({ error: "Unable to trigger replay." }))) as {
            error?: string;
          };
          setActions((prev) => ({
            ...prev,
            [event.id]: { error: body.error ?? "Unable to trigger replay." },
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to trigger replay.";
        setActions((prev) => ({
          ...prev,
          [event.id]: { error: message },
        }));
      } finally {
        setPending((prev) => ({ ...prev, [event.id]: false }));
      }
    });
  };

  const renderStatusBadge = (status: ProcessorReplayStatus) => {
    const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
    switch (status) {
      case "succeeded":
        return <span className={`${base} bg-emerald-500/20 text-emerald-300`}>Succeeded</span>;
      case "failed":
        return <span className={`${base} bg-rose-500/20 text-rose-300`}>Failed</span>;
      case "in-progress":
        return <span className={`${base} bg-amber-500/20 text-amber-200`}>In progress</span>;
      case "queued":
        return <span className={`${base} bg-sky-500/20 text-sky-200`}>Queued</span>;
      default:
        return <span className={`${base} bg-slate-500/20 text-slate-200`}>Pending</span>;
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) {
      return "—";
    }
    return dateFormatter.format(new Date(value));
  };

  return (
    <section className="space-y-6" data-testid="replay-dashboard">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col">
          <label className="text-xs uppercase tracking-wide text-white/60" htmlFor="provider-filter">
            Provider
          </label>
          <select
            id="provider-filter"
            className="mt-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white shadow-sm focus:border-sky-400 focus:outline-none"
            value={filters.provider ?? "all"}
            onChange={(event) => {
              const value = event.target.value;
              setFilters((prev) => ({ ...prev, provider: value }));
            }}
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs uppercase tracking-wide text-white/60" htmlFor="status-filter">
            Replay status
          </label>
          <select
            id="status-filter"
            className="mt-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white shadow-sm focus:border-sky-400 focus:outline-none"
            value={filters.status ?? "all"}
            onChange={(event) => {
              const value = event.target.value as ProcessorReplayStatus | "all";
              setFilters((prev) => ({ ...prev, status: value }));
            }}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex grow flex-col">
          <label className="text-xs uppercase tracking-wide text-white/60" htmlFor="correlation-filter">
            Correlation ID
          </label>
          <input
            id="correlation-filter"
            className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-sky-400 focus:outline-none"
            placeholder="Search by correlation or invoice ID"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/5 text-left text-sm uppercase tracking-wider text-white/60">
            <tr>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">External ID</th>
              <th className="px-4 py-3">Correlation</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Replay attempts</th>
              <th className="px-4 py-3">Last replay</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm text-white/90">
            {filteredEvents.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-white/50" colSpan={8}>
                  No processor events match the current filters.
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => {
                const action = actions[event.id];
                const isEventPending = pending[event.id] || isPending;
                return (
                  <tr key={event.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 align-top text-white/70">{formatDate(event.receivedAt)}</td>
                    <td className="px-4 py-3 align-top uppercase text-white/70">{event.provider}</td>
                    <td className="px-4 py-3 align-top font-mono text-xs">{event.externalId}</td>
                    <td className="px-4 py-3 align-top font-mono text-xs">
                      {event.correlationId ?? event.invoiceId ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top">{renderStatusBadge(event.status)}</td>
                    <td className="px-4 py-3 align-top">{event.replayAttempts}</td>
                    <td className="px-4 py-3 align-top text-white/70">{formatDate(event.replayedAt)}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md border border-sky-400/60 bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:border-slate-500/40 disabled:bg-slate-500/10 disabled:text-slate-300/60"
                          disabled={isEventPending}
                          onClick={() => triggerReplay(event)}
                        >
                          {isEventPending ? "Triggering..." : "Trigger replay"}
                        </button>
                        {action?.requiresForce && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md border border-rose-400/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-slate-500/40 disabled:bg-slate-500/10 disabled:text-slate-300/60"
                            disabled={isEventPending}
                            onClick={() => triggerReplay(event, { force: true })}
                          >
                            Force replay
                          </button>
                        )}
                        {action?.message && !action.error && (
                          <p className="text-xs text-sky-200">{action.message}</p>
                        )}
                        {action?.error && (
                          <p className="text-xs text-rose-300">{action.error}</p>
                        )}
                        {event.lastReplayError && (
                          <details className="text-xs text-rose-200/80">
                            <summary className="cursor-pointer text-rose-300">Last error</summary>
                            <p className="mt-1 whitespace-pre-wrap text-rose-200/80">{event.lastReplayError}</p>
                          </details>
                        )}
                        {event.replayRequestedAt && (
                          <p className="text-xs text-white/50">
                            Requested {formatDate(event.replayRequestedAt)}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
