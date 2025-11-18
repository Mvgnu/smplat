"use client";

import { useCallback, useMemo, useState } from "react";

import type { OnboardingExperimentEvent, OnboardingExperimentExportResponse } from "@/types/reporting";

const limitOptions = [100, 250, 500];
const csvHeaders: Array<keyof OnboardingExperimentEvent> = [
  "eventId",
  "journeyId",
  "orderId",
  "orderNumber",
  "slug",
  "variantKey",
  "variantName",
  "isControl",
  "assignmentStrategy",
  "status",
  "featureFlagKey",
  "recordedAt"
];

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const asString =
    typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  if (asString.includes(",") || asString.includes('"') || asString.includes("\n")) {
    return `"${asString.replace(/"/g, '""')}"`;
  }
  return asString;
}

function buildCsv(events: OnboardingExperimentEvent[]): string {
  const headerRow = csvHeaders.join(",");
  const rows = events.map((event) =>
    csvHeaders.map((key) => formatCsvValue(event[key])).join(",")
  );
  return [headerRow, ...rows].join("\n");
}

function triggerCsvDownload(events: OnboardingExperimentEvent[]): void {
  const csv = buildCsv(events);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `onboarding-experiments-${timestamp}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function requestExport(limit: number, cursor: string | null): Promise<OnboardingExperimentExportResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(`/api/reporting/onboarding/experiment-events?${params.toString()}`, {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("Failed to load onboarding experiment export");
  }
  return (await response.json()) as OnboardingExperimentExportResponse;
}

export function OnboardingExperimentExportControls() {
  const [limit, setLimit] = useState<number>(250);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextCursorLabel = useMemo(() => {
    if (!nextCursor) {
      return null;
    }
    const parsed = new Date(nextCursor);
    const formatted = Number.isNaN(parsed.getTime()) ? nextCursor : parsed.toLocaleString();
    return `Next cursor ready (${formatted})`;
  }, [nextCursor]);

  const handleDownload = useCallback(
    async (cursor: string | null) => {
      setIsDownloading(true);
      setError(null);
      setStatus(null);
      try {
        const payload = await requestExport(limit, cursor);
        triggerCsvDownload(payload.events);
        setNextCursor(payload.nextCursor ?? null);
        const downloadLabel =
          payload.events.length === 0 ? "No events found" : `Downloaded ${payload.events.length} events`;
        const cursorLabel = payload.nextCursor ? " — Next page available" : "";
        setStatus(`${downloadLabel}${cursorLabel}`);
      } catch (error_) {
        console.error("Failed to export onboarding experiment events", error_);
        setError("Unable to fetch export. Please retry.");
      } finally {
        setIsDownloading(false);
      }
    },
    [limit]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm text-white/70" htmlFor="experiment-export-limit">
          Rows per batch
          <select
            id="experiment-export-limit"
            className="mt-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            disabled={isDownloading}
          >
            {limitOptions.map((entry) => (
              <option key={entry} value={entry}>
                {entry.toLocaleString()} rows
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDownloading}
            onClick={() => handleDownload(null)}
          >
            {isDownloading ? "Downloading…" : "Download latest"}
          </button>
          <button
            type="button"
            className="rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:border-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDownloading || !nextCursor}
            onClick={() => handleDownload(nextCursor)}
          >
            Download next page
          </button>
        </div>
      </div>

      {nextCursorLabel && (
        <p className="text-xs font-medium text-white/60">
          {nextCursorLabel}
        </p>
      )}
      {status && (
        <p className="text-xs font-medium text-emerald-300" aria-live="polite">
          {status}
        </p>
      )}
      {error && (
        <p className="text-xs font-medium text-rose-300" aria-live="assertive">
          {error}
        </p>
      )}
    </div>
  );
}
