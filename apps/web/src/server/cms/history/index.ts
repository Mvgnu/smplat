// meta: module: marketing-preview-history-index
// meta: feature: marketing-preview-cockpit

export {
  createHistoryHash,
  fetchSnapshotHistory,
  persistSnapshotManifest,
  querySnapshotHistory,
  recordGovernanceAction,
  resetHistoryStore,
  __internal
} from "./store";
export type {
  MarketingPreviewGovernanceStats,
  MarketingPreviewHistoryAggregates,
  MarketingPreviewHistoryEntry,
  MarketingPreviewHistoryNoteSummary,
  MarketingPreviewHistoryQuery,
  MarketingPreviewHistoryQueryResult,
  MarketingPreviewHistoryRouteRecord
} from "./types";
