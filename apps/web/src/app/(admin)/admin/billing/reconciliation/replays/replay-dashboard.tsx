"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  ProcessorReplayDetail,
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

type ReplayStreamFrame = {
  cursor: string | null;
  events?: ProcessorReplayEvent[];
};

export function ReplayDashboardView({ initialEvents }: ReplayDashboardProps) {
  const router = useRouter();
  const [events, setEvents] = useState<ProcessorReplayEvent[]>(initialEvents);
  const [filters, setFilters] = useState<ProcessorReplayFilters>({ status: "queued" });
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [actions, setActions] = useState<ReplayActionMap>({});
  const [pending, setPending] = useState<PendingState>({});
  const [isPending, startTransition] = useTransition();
  const [workspaceId, setWorkspaceId] = useState<string>("all");
  const latestTimestampRef = useRef<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessorReplayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const providerFilter = filters.provider ?? "all";
  const statusFilter = filters.status ?? "all";
  const correlationFilter = filters.correlationId ?? "";

  const mergeEvents = useCallback(
    (incoming: ProcessorReplayEvent[], replace = false) => {
      if (incoming.length === 0 && !replace) {
        return;
      }

      const baseline = cursorRef.current ?? latestTimestampRef.current;
      const nextLatest = incoming.reduce<string | null>((acc, event) => {
        if (!acc) {
          return event.receivedAt;
        }
        return acc > event.receivedAt ? acc : event.receivedAt;
      }, baseline);

      setEvents((prev) => {
        const base = replace ? [] : prev;
        const map = new Map(base.map((item) => [item.id, item] as const));
        incoming.forEach((event) => {
          map.set(event.id, event);
        });
        const merged = Array.from(map.values());
        merged.sort((a, b) => (a.receivedAt > b.receivedAt ? -1 : a.receivedAt < b.receivedAt ? 1 : 0));
        return merged;
      });

      latestTimestampRef.current = nextLatest;
      cursorRef.current = nextLatest;
    },
    [],
  );

  useEffect(() => {
    setEvents(initialEvents);
    const latest = initialEvents.reduce<string | null>((acc, event) => {
      if (!acc) {
        return event.receivedAt;
      }
      return acc > event.receivedAt ? acc : event.receivedAt;
    }, cursorRef.current ?? latestTimestampRef.current);
    latestTimestampRef.current = latest;
    cursorRef.current = latest;
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

  const buildParams = useCallback(
    (includeSince: boolean) => {
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("requestedOnly", "false");
      if (workspaceId !== "all" && workspaceId !== "__unassigned__") {
        params.set("workspaceId", workspaceId);
      }
      if (providerFilter !== "all") {
        params.set("provider", providerFilter);
      }
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (correlationFilter) {
        params.set("correlationId", correlationFilter);
      }
      if (includeSince && cursorRef.current) {
        params.set("since", cursorRef.current);
      }
      return params;
    },
    [workspaceId, providerFilter, statusFilter, correlationFilter],
  );

  const fetchSnapshot = useCallback(
    async (replace: boolean) => {
      if (!replace && !cursorRef.current) {
        return;
      }
      const params = buildParams(!replace);
      const url = `/api/billing/replays?${params.toString()}`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Upstream responded with ${response.status}`);
        }
        const body = (await response.json()) as { events: ProcessorReplayEvent[] };
        mergeEvents(body.events, replace);
        setPollError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to refresh replays.";
        if (replace) {
          setPollError(message);
        }
      }
    },
    [buildParams, mergeEvents],
  );

  const stopFallback = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
  }, []);

  const startFallback = useCallback(() => {
    if (fallbackIntervalRef.current) {
      return;
    }
    fetchSnapshot(true).catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to refresh replays.";
      setPollError(message);
    });
    fallbackIntervalRef.current = setInterval(() => {
      fetchSnapshot(false).catch(() => undefined);
    }, 8000);
  }, [fetchSnapshot]);

  useEffect(() => {
    let cancelled = false;
    setPollError(null);
    stopFallback();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    cursorRef.current = null;
    latestTimestampRef.current = null;

    const params = buildParams(false);
    const url = `/api/billing/replays/stream?${params.toString()}`;

    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handleFrame = (event: MessageEvent<string>, replace: boolean) => {
      if (cancelled) {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as ReplayStreamFrame;
        if (payload.cursor) {
          cursorRef.current = payload.cursor;
          latestTimestampRef.current = payload.cursor;
        }
        mergeEvents(payload.events ?? [], replace);
        setPollError(null);
      } catch (error) {
        console.error("Failed to parse replay stream payload", error);
      }
    };

    source.addEventListener("snapshot", (event) => handleFrame(event as MessageEvent<string>, true));
    source.addEventListener("update", (event) => handleFrame(event as MessageEvent<string>, false));
    source.addEventListener("heartbeat", (event) => {
      if (cancelled) {
        return;
      }
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as ReplayStreamFrame;
        if (payload.cursor) {
          cursorRef.current = payload.cursor;
          latestTimestampRef.current = payload.cursor;
        }
      } catch (_error) {
        // Ignore malformed heartbeat payloads.
      }
    });

    source.onerror = () => {
      if (cancelled) {
        return;
      }
      source.close();
      eventSourceRef.current = null;
      setPollError("Stream disconnected; falling back to polling.");
      startFallback();
    };

    return () => {
      cancelled = true;
      source.close();
      eventSourceRef.current = null;
      stopFallback();
    };
  }, [buildParams, mergeEvents, startFallback, stopFallback]);

  useEffect(() => {
    if (!selectedEventId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    const params = new URLSearchParams();
    if (workspaceId !== "all" && workspaceId !== "__unassigned__") {
      params.set("workspaceId", workspaceId);
    }
    const query = params.toString();

    const fetchDetail = async () => {
      try {
        const response = await fetch(
          `/api/billing/replays/${selectedEventId}${query ? `?${query}` : ""}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error(`Upstream responded with ${response.status}`);
        }
        const body = (await response.json()) as { event: ProcessorReplayDetail };
        if (cancelled) {
          return;
        }
        setDetail(body.event);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load replay detail.";
        setDetailError(message);
        setDetail(null);
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId, workspaceId]);

  const providerOptions = useMemo<{ label: string; value: string }[]>(() => {
    const providers = Array.from(new Set(events.map((event) => event.provider.toLowerCase())));
    providers.sort();
    return [{ label: "All providers", value: "all" }].concat(
      providers.map((provider) => ({
        label: provider.charAt(0).toUpperCase() + provider.slice(1),
        value: provider,
      })),
    );
  }, [events]);

  const workspaceOptions = useMemo<{ label: string; value: string }[]>(() => {
    const ids = new Set(events.map((event) => event.workspaceId ?? "__unassigned__"));
    const options = Array.from(ids)
      .filter((id) => id !== "__unassigned__")
      .map((id) => ({
        label: id,
        value: id,
      }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    if (ids.has("__unassigned__")) {
      options.push({ label: "Unassigned", value: "__unassigned__" });
    }
    return [{ label: "All workspaces", value: "all" }, ...options];
  }, [events]);

  const visibleEvents = events;

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
        const params = new URLSearchParams();
        if (workspaceId !== "all" && workspaceId !== "__unassigned__") {
          params.set("workspaceId", workspaceId);
        }
        const query = params.toString();
        const response = await fetch(`/api/billing/replays/${event.id}${query ? `?${query}` : ""}`, {
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
    <>
      <section className="space-y-6" data-testid="replay-dashboard">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col">
          <label className="text-xs uppercase tracking-wide text-white/60" htmlFor="workspace-filter">
            Workspace
          </label>
          <select
            id="workspace-filter"
            className="mt-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white shadow-sm focus:border-sky-400 focus:outline-none"
            value={workspaceId}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
            }}
          >
            {workspaceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

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

      {pollError && (
        <div className="rounded-md border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          Live updates paused: {pollError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/5 text-left text-sm uppercase tracking-wider text-white/60">
            <tr>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">External ID</th>
              <th className="px-4 py-3">Correlation</th>
              <th className="px-4 py-3">Workspace</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Replay attempts</th>
              <th className="px-4 py-3">Last replay</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm text-white/90">
            {visibleEvents.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-white/50" colSpan={8}>
                  No processor events match the current filters.
                </td>
              </tr>
            ) : (
              visibleEvents.map((event) => {
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
                    <td className="px-4 py-3 align-top font-mono text-xs text-white/60">
                      {event.workspaceId ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top">{renderStatusBadge(event.status)}</td>
                    <td className="px-4 py-3 align-top">{event.replayAttempts}</td>
                    <td className="px-4 py-3 align-top text-white/70">{formatDate(event.replayedAt)}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/20"
                          onClick={() => {
                            setSelectedEventId((prev) => (prev === event.id ? null : event.id));
                          }}
                        >
                          {selectedEventId === event.id ? "Hide detail" : "Inspect event"}
                        </button>
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

    {selectedEventId && (
      <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/70 backdrop-blur-sm">
        <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-slate-950/95 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Replay detail</h2>
              <p className="text-sm text-white/60">Deep dive into the processor replay lifecycle.</p>
            </div>
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10"
              onClick={() => setSelectedEventId(null)}
            >
              Close
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {detailLoading && <p className="text-sm text-white/70">Loading replay details…</p>}
            {detailError && !detailLoading && (
              <p className="rounded-md border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">
                {detailError}
              </p>
            )}
            {!detailLoading && !detailError && !detail && (
              <p className="text-sm text-white/60">Replay detail unavailable for this event.</p>
            )}

            {detail && (
              <>
                <section className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Event summary</h3>
                  <dl className="grid grid-cols-2 gap-3 text-sm text-white/80">
                    <div>
                      <dt className="text-xs uppercase text-white/50">Provider</dt>
                      <dd className="font-mono text-xs uppercase text-white/80">{detail.provider}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase text-white/50">Workspace</dt>
                      <dd className="font-mono text-xs text-white/70">{detail.workspaceId ?? "—"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs uppercase text-white/50">External ID</dt>
                      <dd className="font-mono text-xs text-white/80 break-words">{detail.externalId}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs uppercase text-white/50">Correlation</dt>
                      <dd className="font-mono text-xs text-white/70">
                        {detail.correlationId ?? detail.invoiceId ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase text-white/50">Status</dt>
                      <dd>{renderStatusBadge(detail.status)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase text-white/50">Last replay</dt>
                      <dd className="text-xs text-white/70">{formatDate(detail.replayedAt)}</dd>
                    </div>
                    {detail.lastReplayError && (
                      <div className="col-span-2">
                        <dt className="text-xs uppercase text-rose-300/80">Last error</dt>
                        <dd className="mt-1 whitespace-pre-wrap rounded bg-rose-500/10 p-3 text-xs text-rose-100">
                          {detail.lastReplayError}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                <section className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Replay timeline</h3>
                  {detail.attempts.length === 0 ? (
                    <p className="text-sm text-white/60">No replay attempts have been recorded.</p>
                  ) : (
                    <ul className="space-y-3">
                      {detail.attempts.map((attempt) => (
                        <li
                          key={attempt.id}
                          className="rounded-md border border-white/10 bg-black/40 p-3 text-sm text-white/80"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">
                              {attempt.status === "succeeded" ? "Succeeded" : attempt.status}
                            </span>
                            <span className="text-xs text-white/60">{formatDate(attempt.attemptedAt)}</span>
                          </div>
                          {attempt.error && (
                            <p className="mt-2 text-xs text-rose-300">{attempt.error}</p>
                          )}
                          {attempt.metadata && (
                            <details className="mt-2 text-xs text-white/70">
                              <summary className="cursor-pointer text-white/80">Metadata</summary>
                              <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/60 p-2 text-[11px] text-white/70">
                                {JSON.stringify(attempt.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Invoice snapshot</h3>
                  {detail.invoiceSnapshot ? (
                    <dl className="grid grid-cols-2 gap-3 text-sm text-white/80">
                      <div>
                        <dt className="text-xs uppercase text-white/50">Invoice</dt>
                        <dd className="font-mono text-xs text-white/80">
                          {detail.invoiceSnapshot.number} ({detail.invoiceSnapshot.id})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-white/50">Status</dt>
                        <dd className="text-xs text-white/70">{detail.invoiceSnapshot.status}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-white/50">Total</dt>
                        <dd className="text-xs text-white/70">
                          {detail.invoiceSnapshot.currency} {detail.invoiceSnapshot.total.toFixed(2)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-white/50">Issued</dt>
                        <dd className="text-xs text-white/70">{formatDate(detail.invoiceSnapshot.issuedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-white/50">Due</dt>
                        <dd className="text-xs text-white/70">{formatDate(detail.invoiceSnapshot.dueAt)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-white/60">This replay is not linked to an invoice.</p>
                  )}
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    )}
    </>
  );
}
