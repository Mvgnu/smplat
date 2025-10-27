// meta: module: marketing-preview-history-client
// meta: feature: marketing-preview-cockpit

import { z } from "zod";

import type { MarketingPreviewHistoryQuery } from "@/server/cms/history";
import type { MarketingPreviewTriageNoteSeverity } from "@/server/cms/preview/notes";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest
} from "@/server/cms/preview";

const metricsSchema = z.object({
  label: z.string().optional(),
  values: z.array(z.object({ label: z.string().optional(), value: z.string().optional() }))
});

const snapshotSchema: z.ZodType<MarketingPreviewSnapshot> = z.object({
  route: z.string(),
  preview: z.boolean(),
  hero: z.any().optional(),
  title: z.string().optional(),
  sectionCount: z.number(),
  blockKinds: z.array(z.string()),
  metrics: metricsSchema.optional(),
  markup: z.string()
});

const liveDeltaPayloadSchema = z.object({
  route: z.string().nullish(),
  slug: z.string().nullish(),
  label: z.string().nullish(),
  environment: z.string().nullish(),
  generatedAt: z.string(),
  markup: z.string().nullish(),
  blockKinds: z.array(z.string()),
  sectionCount: z.number(),
  variant: z.object({
    key: z.string(),
    label: z.string(),
    persona: z.string().nullish(),
    campaign: z.string().nullish(),
    featureFlag: z.string().nullish()
  }),
  collection: z.string().nullish(),
  docId: z.string().nullish(),
  metrics: metricsSchema.nullish(),
  hero: z.any().optional(),
  validation: z
    .object({
      ok: z.boolean(),
      warnings: z.array(z.string()),
      blocks: z.array(z.record(z.any()))
    })
    .optional(),
  diagnostics: z.record(z.any()).optional()
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
    .optional(),
  liveDeltas: z
    .array(
      z.object({
        id: z.string(),
        manifestGeneratedAt: z.string().nullish(),
        generatedAt: z.string(),
        route: z.string().nullish(),
        variantKey: z.string().nullish(),
        payloadHash: z.string(),
        recordedAt: z.string(),
        payload: liveDeltaPayloadSchema
      })
    )
    .default([]),
  remediations: z
    .array(
      z.object({
        id: z.string(),
        manifestGeneratedAt: z.string().nullish(),
        route: z.string(),
        action: z.union([z.literal("reset"), z.literal("prioritize")]),
        fingerprint: z.string().nullish(),
        summary: z
          .object({
            totalBlocks: z.number().optional(),
            invalidBlocks: z.number().optional(),
            warningBlocks: z.number().optional()
          })
          .nullish(),
        collection: z.string().nullish(),
        docId: z.string().nullish(),
        payloadHash: z.string(),
        recordedAt: z.string()
      })
    )
    .default([]),
  noteRevisions: z
    .array(
      z.object({
        id: z.string(),
        noteId: z.string(),
        manifestGeneratedAt: z.string(),
        route: z.string(),
        severity: z.union([z.literal("info"), z.literal("warning"), z.literal("blocker")]),
        body: z.string(),
        authorHash: z.string().nullish(),
        payloadHash: z.string(),
        recordedAt: z.string()
      })
    )
    .default([])
});

const regressionVelocitySchema = z.object({
  averagePerHour: z.number(),
  currentPerHour: z.number(),
  sampleSize: z.number(),
  confidence: z.number()
});

const severityMomentumSchema = z.object({
  info: z.number(),
  warning: z.number(),
  blocker: z.number(),
  overall: z.number(),
  sampleSize: z.number()
});

const timeToGreenSchema = z.object({
  forecastAt: z.string().nullable(),
  forecastHours: z.number().nullable(),
  slopePerHour: z.number().nullable(),
  confidence: z.number(),
  sampleSize: z.number()
});

const recommendationSchema = z.object({
  fingerprint: z.string(),
  suggestion: z.string(),
  occurrences: z.number(),
  confidence: z.number(),
  lastSeenAt: z.string().nullable(),
  affectedRoutes: z.array(z.string())
});

const historyResponseSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  entries: z.array(historyEntrySchema),
  analytics: z.object({
    regressionVelocity: regressionVelocitySchema,
    severityMomentum: severityMomentumSchema,
    timeToGreen: timeToGreenSchema,
    recommendations: z.array(recommendationSchema)
  })
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
