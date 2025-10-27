// meta: module: marketing-preview-history-client
// meta: feature: marketing-preview-cockpit

import { z } from "zod";

import type { MarketingPreviewHistoryQuery } from "@/server/cms/history";
import type { MarketingPreviewTriageNoteSeverity } from "@/server/cms/preview/notes";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest
} from "@/server/cms/preview";

const snapshotSchema: z.ZodType<MarketingPreviewSnapshot> = z.object({
  route: z.string(),
  preview: z.boolean(),
  hero: z.any().optional(),
  title: z.string().optional(),
  sectionCount: z.number(),
  blockKinds: z.array(z.string()),
  metrics: z
    .object({
      label: z.string().optional(),
      values: z.array(z.object({ label: z.string().optional(), value: z.string().optional() }))
    })
    .optional(),
  markup: z.string()
});

const manifestSchema: z.ZodType<MarketingPreviewSnapshotManifest> = z.object({
  generatedAt: z.string(),
  snapshots: z.array(snapshotSchema),
  label: z.string().optional()
});

const historyEntrySchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  label: z.string().nullish(),
  manifest: manifestSchema,
  routes: z.array(
    z.object({
      route: z.string(),
      routeHash: z.string(),
      diffDetected: z.boolean(),
      hasDraft: z.boolean(),
      hasPublished: z.boolean(),
      sectionCount: z.number(),
      blockKinds: z.array(z.string())
    })
  ),
  aggregates: z.object({
    totalRoutes: z.number(),
    diffDetectedRoutes: z.number(),
    draftRoutes: z.number(),
    publishedRoutes: z.number()
  }),
  governance: z.object({
    totalActions: z.number(),
    actionsByKind: z.record(z.number()),
    lastActionAt: z.string().nullable().optional()
  }),
  notes: z
    .object({
      total: z.number(),
      severityCounts: z.object({
        info: z.number().default(0),
        warning: z.number().default(0),
        blocker: z.number().default(0)
      })
    })
    .optional()
});

const historyResponseSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  entries: z.array(historyEntrySchema)
});

export type MarketingPreviewHistoryResponse = z.infer<typeof historyResponseSchema>;
export type MarketingPreviewHistoryEntryResponse = z.infer<typeof historyEntrySchema>;

export type MarketingPreviewHistoryClientParams = MarketingPreviewHistoryQuery & {
  severity?: MarketingPreviewTriageNoteSeverity;
  signal?: AbortSignal;
};

const buildQuery = (params: MarketingPreviewHistoryClientParams) => {
  const search = new URLSearchParams();
  if (typeof params.limit === "number") {
    search.set("limit", params.limit.toString());
  }
  if (typeof params.offset === "number") {
    search.set("offset", params.offset.toString());
  }
  if (params.route) {
    search.set("route", params.route);
  }
  if (params.variant) {
    search.set("variant", params.variant);
  }
  if (params.severity) {
    search.set("severity", params.severity);
  }
  return search.toString();
};

export const fetchMarketingPreviewHistory = async (
  params: MarketingPreviewHistoryClientParams
): Promise<MarketingPreviewHistoryResponse> => {
  const query = buildQuery(params);
  const url = query ? `/api/marketing-preview/history?${query}` : "/api/marketing-preview/history";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    signal: params.signal,
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((data: { error?: string }) => data.error ?? "Failed to load marketing preview history")
      .catch(() => "Failed to load marketing preview history");
    throw new Error(message);
  }

  const payload = await response.json();
  return historyResponseSchema.parse(payload);
};
