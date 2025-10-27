// meta: route: api/marketing-preview/history
// meta: feature: marketing-preview-cockpit

import { NextResponse } from "next/server";

import {
  buildHistoryAnalytics,
  querySnapshotHistory,
  type MarketingPreviewHistoryEntry,
  type MarketingPreviewHistoryQuery
} from "@/server/cms/history";
import {
  getMarketingPreviewNotes,
  type MarketingPreviewTriageNote,
  type MarketingPreviewTriageNoteSeverity
} from "@/server/cms/preview/notes";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const parseInteger = (value: string | null, fallback: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
};

const parseVariant = (value: string | null): MarketingPreviewHistoryQuery["variant"] => {
  if (value === "draft" || value === "published") {
    return value;
  }
  return undefined;
};

const parseSeverity = (value: string | null): MarketingPreviewTriageNoteSeverity | undefined => {
  if (value === "info" || value === "warning" || value === "blocker") {
    return value;
  }
  return undefined;
};

const createSeverityCounts = () => ({
  info: 0,
  warning: 0,
  blocker: 0
});

const aggregateNotesForEntry = (
  entry: MarketingPreviewHistoryEntry,
  notes: MarketingPreviewTriageNote[]
) => {
  const severityCounts = createSeverityCounts();
  const entryNotes = notes.filter((note) => note.generatedAt === entry.generatedAt);

  for (const note of entryNotes) {
    severityCounts[note.severity] += 1;
  }

  return {
    total: entryNotes.length,
    severityCounts
  };
};

const filterBySeverity = (
  entries: MarketingPreviewHistoryEntry[],
  severity: MarketingPreviewTriageNoteSeverity | undefined
): MarketingPreviewHistoryEntry[] => {
  if (!severity) {
    return entries;
  }
  return entries.filter((entry) => (entry.notes?.severityCounts?.[severity] ?? 0) > 0);
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInteger(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(parseInteger(searchParams.get("offset"), 0), 0);
  const route = searchParams.get("route") ?? undefined;
  const variant = parseVariant(searchParams.get("variant"));
  const severity = parseSeverity(searchParams.get("severity"));

  const queryLimit = Math.max(limit + offset, MAX_LIMIT);
  const history = querySnapshotHistory({ limit: queryLimit, offset: 0, route, variant });
  const notes = await getMarketingPreviewNotes();

  const enrichedEntries = history.entries.map((entry) => ({
    ...entry,
    notes: aggregateNotesForEntry(entry, notes)
  }));

  const filtered = filterBySeverity(enrichedEntries, severity);
  const paginated = filtered.slice(offset, offset + limit);
  const analytics = buildHistoryAnalytics(filtered);

  return NextResponse.json({
    total: filtered.length,
    limit,
    offset,
    entries: paginated,
    analytics
  });
}
