'use client';

import { useCallback, useMemo, useState, useTransition } from "react";
import type { ExperimentConversionMetric } from "@/types/reporting";

type ExperimentConversionCardClientProps = {
  initialEntries: ExperimentConversionMetric[];
  initialCursor?: string | null;
  initialRequestCursor?: string | null;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 8;

export function ExperimentConversionCardClient({
  initialEntries,
  initialCursor = null,
  initialRequestCursor = null,
  pageSize = DEFAULT_PAGE_SIZE
}: ExperimentConversionCardClientProps) {
  const [entries, setEntries] = useState<ExperimentConversionMetric[]>(initialEntries ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [hasCustomCursor, setHasCustomCursor] = useState<boolean>(Boolean(initialRequestCursor));
  const [requestCursor, setRequestCursor] = useState<string | null>(initialRequestCursor ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasMore = Boolean(nextCursor);

  const updateUrlCursor = useCallback((value: string | null) => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set("conversionCursor", value);
    } else {
      url.searchParams.delete("conversionCursor");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const uniqueEntries = useMemo(() => {
    const deduped = new Map<string, ExperimentConversionMetric>();
    for (const entry of entries) {
      if (!entry.slug) {
        continue;
      }
      deduped.set(entry.slug, entry);
    }
    return Array.from(deduped.values());
  }, [entries]);

  const formatCurrency = (amount: number, currency?: string | null): string => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return "—";
    }
    const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: amount >= 1000 ? 0 : 2
    }).format(amount);
  };

  const formatNumber = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
      return "—";
    }
    return new Intl.NumberFormat("en-US").format(Math.round(value));
  };

  const loadMore = () => {
    if (!nextCursor || isPending) {
      return;
    }
    const cursorToRequest = nextCursor;
    startTransition(async () => {
      try {
        setError(null);
        const params = new URLSearchParams({ limit: String(pageSize) });
        if (cursorToRequest) {
          params.set("cursor", cursorToRequest);
        }
        const response = await fetch(`/api/reporting/onboarding/experiment-conversions?${params.toString()}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as { metrics: ExperimentConversionMetric[]; nextCursor: string | null };
        setEntries((previous) => {
          const merged = [...previous];
          for (const metric of payload.metrics ?? []) {
            if (!metric.slug) {
              continue;
            }
            const existingIndex = merged.findIndex((entry) => entry.slug === metric.slug);
            if (existingIndex >= 0) {
              merged[existingIndex] = metric;
            } else {
              merged.push(metric);
            }
          }
          return merged;
        });
        setNextCursor(payload.nextCursor ?? null);
        setHasCustomCursor(true);
        setRequestCursor(cursorToRequest);
        updateUrlCursor(cursorToRequest);
      } catch (loadError) {
        console.error("Unable to load conversion snapshot", loadError);
        setError("Unable to load additional conversion rows. Try again in a moment.");
      }
    });
  };

  const resetToLatest = () => {
    if (isPending) {
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        const params = new URLSearchParams({ limit: String(pageSize) });
        const response = await fetch(`/api/reporting/onboarding/experiment-conversions?${params.toString()}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as { metrics: ExperimentConversionMetric[]; nextCursor: string | null };
        setEntries(Array.isArray(payload.metrics) ? payload.metrics : []);
        setNextCursor(payload.nextCursor ?? null);
        setHasCustomCursor(false);
        setRequestCursor(null);
        updateUrlCursor(null);
      } catch (resetError) {
        console.error("Unable to reset conversion snapshot", resetError);
        setError("Unable to refresh conversions. Try again in a moment.");
      }
    });
  };

  const cardTone = hasCustomCursor
    ? "border-amber-400/60 bg-amber-500/10 shadow-[0_0_25px_rgba(251,191,36,0.25)]"
    : "border-white/10 bg-black/30";

  return (
    <article className={`space-y-4 rounded-3xl p-6 transition ${cardTone}`}>
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Conversions</p>
          <h3 className="text-lg font-semibold text-white">Orders + revenue attributed</h3>
        </div>
        <div className="text-right text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
          <p>{uniqueEntries.length > 0 ? `${uniqueEntries.length} slugs tracked` : "Awaiting telemetry"}</p>
          {hasCustomCursor && requestCursor ? (
            <span className="mt-1 inline-flex flex-wrap items-center justify-end gap-1 text-[10px] text-amber-200">
              <span aria-hidden="true" className="text-[0.8rem]">
                ⏱
              </span>
              Historical cursor
              <code className="rounded border border-amber-200/40 bg-white/10 px-1 py-0.5 font-mono text-[10px]">
                {requestCursor}
              </code>
            </span>
          ) : (
            <span className="mt-1 text-[10px] text-white/50">Latest snapshot</span>
          )}
          {nextCursor ? (
            <span className="mt-1 text-[10px] text-white/50">
              Next cursor{" "}
              <code className="ml-1 rounded bg-white/10 px-1 py-0.5 font-mono text-[10px]">{nextCursor}</code>
            </span>
          ) : null}
        </div>
      </header>

      {uniqueEntries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/60">
          We have not seen experiment-tagged orders yet. Once conversions flow, order + journey counts per slug will populate here.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {uniqueEntries.map((entry) => (
            <article key={entry.slug} className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-4 text-white">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Slug</p>
                  <p className="text-base font-semibold text-white">{entry.slug}</p>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">
                    {entry.orderCurrency ?? "USD"} impact
                  </p>
                </div>
                <div className="text-right text-xs text-white/60">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-white/40">Revenue</p>
                  <p className="text-lg font-semibold text-white">
                    {formatCurrency(entry.orderTotal, entry.orderCurrency)}
                  </p>
                  <p>Loyalty {formatNumber(entry.loyaltyPoints)} pts</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-white/70">
                <p>Orders {entry.orderCount}</p>
                <p>Journeys {entry.journeyCount}</p>
                <p className="font-mono">
                  {entry.lastActivity ? new Date(entry.lastActivity).toLocaleDateString() : "—"}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}

      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Loading..." : "Load next conversions"}
          </button>
        ) : null}
        {hasCustomCursor ? (
          <button
            type="button"
            onClick={resetToLatest}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Resetting..." : "Reset conversions"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
