"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { formatPlatformContextLabel } from "@/lib/platform-context";
import { trackGuardrailAutomation } from "@/lib/telemetry/events";
import type { GuardrailFollowUpEntry } from "@/types/reporting";

type GuardrailFollowUpTimelineProps = {
  providerId: string;
  title?: string;
  emptyState?: string;
  initialEntries: GuardrailFollowUpEntry[];
  initialNextCursor: string | null;
  defaultOpen?: boolean;
  className?: string;
};

export function GuardrailFollowUpTimeline({
  providerId,
  title = "Follow-up history",
  emptyState = "No follow-ups logged yet.",
  initialEntries,
  initialNextCursor,
  defaultOpen = false,
  className,
}: GuardrailFollowUpTimelineProps) {
  const [entries, setEntries] = useState<GuardrailFollowUpEntry[]>(initialEntries);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [isPending, startTransition] = useTransition();
  const trackedFollowUps = useRef<Set<string>>(new Set());
  const containerClass =
    className ??
    "rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white";

  const timelineEntries = useMemo(
    () => entries.map((entry) => ({ ...entry, timestamp: formatTimestamp(entry.createdAt) })),
    [entries],
  );

  const emitTelemetry = useCallback(
    (items: GuardrailFollowUpEntry[], source: "initial" | "load-more") => {
      items.forEach((entry) => {
        if (trackedFollowUps.current.has(entry.id)) {
          return;
        }
        trackedFollowUps.current.add(entry.id);
        void trackGuardrailAutomation({
          slug: entry.providerId,
          variantKey: entry.providerName ?? entry.providerId,
          action: entry.action,
          providerId: entry.providerId,
          tags: {
            platformSlug: entry.platformContext?.id ?? null,
          },
          metadata: {
            followUpId: entry.id,
            source,
            conversionCursor: entry.conversionCursor ?? null,
            conversionHref: entry.conversionHref ?? null,
          },
        });
      });
    },
    [],
  );

  useEffect(() => {
    setEntries(initialEntries);
    setNextCursor(initialNextCursor);
  }, [providerId, initialEntries, initialNextCursor]);

  useEffect(() => {
    trackedFollowUps.current.clear();
  }, [providerId]);

  useEffect(() => {
    emitTelemetry(initialEntries, "initial");
  }, [initialEntries, emitTelemetry]);

  const handleLoadMore = () => {
    if (!nextCursor || isPending) {
      return;
    }
    startTransition(async () => {
      try {
        const params = new URLSearchParams({
          providerId,
          cursor: nextCursor,
        });
        const response = await fetch(`/api/reporting/guardrail-followups?${params.toString()}`);
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as {
          entries: GuardrailFollowUpEntry[];
          nextCursor: string | null;
        };
        setEntries((current) => {
          const existingIds = new Set(current.map((entry) => entry.id));
          const merged = [...current];
          for (const entry of payload.entries) {
            if (!existingIds.has(entry.id)) {
              merged.push(entry);
            }
          }
          return merged;
        });
        emitTelemetry(payload.entries, "load-more");
        setNextCursor(payload.nextCursor ?? null);
      } catch (error) {
        console.warn("Unable to load more guardrail follow-ups", error);
      }
    });
  };

  return (
    <details className={containerClass} open={defaultOpen || entries.length > 0}>
      <summary className="cursor-pointer text-sm font-semibold text-white">{title}</summary>
      {timelineEntries.length === 0 ? (
        <p className="mt-2 text-xs text-white/60">{emptyState}</p>
      ) : (
        <ol className="mt-4 space-y-3 text-sm text-white/80">
          {timelineEntries.map((entry) => (
            <li id={`follow-up-${entry.id}`} key={entry.id} className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-white">
                <span className="font-semibold">{formatAction(entry.action)}</span>
                <span className="font-mono text-xs text-white/60">{entry.timestamp}</span>
              </div>
              {entry.notes ? <p className="text-white/70">{entry.notes}</p> : null}
              {entry.platformContext ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-sky-100">
                  {formatPlatformContextLabel(entry.platformContext)}
                </span>
              ) : null}
              {(entry.conversionHref || entry.conversionCursor) ? (
                <p className="text-xs text-white/60">
                  {entry.conversionCursor ? `Historical cursor ${entry.conversionCursor}` : "Live conversion slice"} ·{" "}
                  {entry.conversionHref ? (
                    <a
                      href={entry.conversionHref}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-emerald-200 underline-offset-4 hover:underline"
                    >
                      Open conversions
                    </a>
                  ) : (
                    "Open dashboard"
                  )}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <button
          type="button"
          className="mt-4 inline-flex items-center rounded-full border border-white/20 px-4 py-1 text-xs font-semibold text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleLoadMore}
          disabled={isPending}
        >
          {isPending ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </details>
  );
}

const followUpActionLabels: Record<GuardrailFollowUpEntry["action"], string> = {
  escalate: "Escalated to ops",
  pause: "Paused variant",
  resume: "Resumed automation",
};

function formatAction(action: GuardrailFollowUpEntry["action"]): string {
  return followUpActionLabels[action] ?? action;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}
