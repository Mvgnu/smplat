// meta: module: marketing-preview-history-types
// meta: feature: marketing-preview-cockpit

import type { MarketingPreviewTriageNoteSeverity } from "../preview/notes";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest,
  SnapshotMetrics
} from "../preview/types";

export type MarketingPreviewLiveDeltaPayload = {
  route?: string | null;
  slug?: string | null;
  label?: string | null;
  environment?: string | null;
  generatedAt: string;
  markup?: string | null;
  blockKinds: string[];
  sectionCount: number;
  variant: {
    key: string;
    label: string;
    persona?: string | null;
    campaign?: string | null;
    featureFlag?: string | null;
  };
  collection?: string | null;
  docId?: string | null;
  metrics?: SnapshotMetrics | null;
  hero?: MarketingPreviewSnapshot["hero"];
  validation?: {
    ok: boolean;
    warnings: string[];
    blocks: Array<Record<string, unknown>>;
  };
  diagnostics?: Record<string, unknown>;
};

export type MarketingPreviewLiveDeltaRecord = {
  id: string;
  manifestGeneratedAt?: string | null;
  generatedAt: string;
  route?: string | null;
  variantKey?: string | null;
  payloadHash: string;
  recordedAt: string;
  payload: MarketingPreviewLiveDeltaPayload;
};

export type MarketingPreviewRemediationActionRecord = {
  id: string;
  manifestGeneratedAt?: string | null;
  route: string;
  action: "reset" | "prioritize";
  fingerprint?: string | null;
  summary?: {
    totalBlocks?: number;
    invalidBlocks?: number;
    warningBlocks?: number;
  } | null;
  collection?: string | null;
  docId?: string | null;
  recordedAt: string;
  payloadHash: string;
};

export type MarketingPreviewNoteRevisionRecord = {
  id: string;
  noteId: string;
  manifestGeneratedAt: string;
  route: string;
  severity: MarketingPreviewTriageNoteSeverity;
  body: string;
  authorHash?: string | null;
  recordedAt: string;
  payloadHash: string;
};

export type MarketingPreviewHistoryQuery = {
  limit?: number;
  offset?: number;
  route?: string;
  variant?: "draft" | "published";
};

export type MarketingPreviewHistoryRouteRecord = {
  route: string;
  routeHash: string;
  diffDetected: boolean;
  hasDraft: boolean;
  hasPublished: boolean;
  sectionCount: number;
  blockKinds: string[];
};

export type MarketingPreviewHistoryAggregates = {
  totalRoutes: number;
  diffDetectedRoutes: number;
  draftRoutes: number;
  publishedRoutes: number;
};

export type MarketingPreviewRegressionVelocity = {
  averagePerHour: number;
  currentPerHour: number;
  sampleSize: number;
  confidence: number;
};

export type MarketingPreviewSeverityMomentum = {
  info: number;
  warning: number;
  blocker: number;
  overall: number;
  sampleSize: number;
};

export type MarketingPreviewTimeToGreenForecast = {
  forecastAt: string | null;
  forecastHours: number | null;
  slopePerHour: number | null;
  confidence: number;
  sampleSize: number;
};

export type MarketingPreviewRecommendation = {
  fingerprint: string;
  suggestion: string;
  occurrences: number;
  confidence: number;
  lastSeenAt: string | null;
  affectedRoutes: string[];
};

export type MarketingPreviewHistoryAnalytics = {
  regressionVelocity: MarketingPreviewRegressionVelocity;
  severityMomentum: MarketingPreviewSeverityMomentum;
  timeToGreen: MarketingPreviewTimeToGreenForecast;
  recommendations: MarketingPreviewRecommendation[];
};

export type MarketingPreviewGovernanceStats = {
  totalActions: number;
  actionsByKind: Record<string, number>;
  lastActionAt?: string | null;
};

export type MarketingPreviewHistoryNoteSummary = {
  total: number;
  severityCounts: Record<MarketingPreviewTriageNoteSeverity, number>;
};

export type MarketingPreviewHistoryEntry = {
  id: string;
  generatedAt: string;
  label?: string | null;
  manifest: MarketingPreviewSnapshotManifest;
  routes: MarketingPreviewHistoryRouteRecord[];
  aggregates: MarketingPreviewHistoryAggregates;
  governance: MarketingPreviewGovernanceStats;
  notes?: MarketingPreviewHistoryNoteSummary;
  liveDeltas: MarketingPreviewLiveDeltaRecord[];
  remediations: MarketingPreviewRemediationActionRecord[];
  noteRevisions: MarketingPreviewNoteRevisionRecord[];
};

export type MarketingPreviewHistoryQueryResult = {
  total: number;
  limit: number;
  offset: number;
  entries: MarketingPreviewHistoryEntry[];
  analytics: MarketingPreviewHistoryAnalytics;
};
