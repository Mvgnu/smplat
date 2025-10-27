// meta: module: marketing-preview-history-types
// meta: feature: marketing-preview-cockpit

import type { MarketingPreviewTriageNoteSeverity } from "../preview/notes";
import type { MarketingPreviewSnapshotManifest } from "../preview/types";

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
};

export type MarketingPreviewHistoryQueryResult = {
  total: number;
  limit: number;
  offset: number;
  entries: MarketingPreviewHistoryEntry[];
};
