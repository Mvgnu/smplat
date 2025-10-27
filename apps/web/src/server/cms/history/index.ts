// meta: module: marketing-preview-history-index
// meta: feature: marketing-preview-cockpit

export {
  createHistoryHash,
  fetchSnapshotHistory,
  persistSnapshotManifest,
  querySnapshotHistory,
  recordGovernanceAction,
  recordLivePreviewDelta,
  recordRemediationAction,
  recordNoteRevision,
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
  MarketingPreviewHistoryRouteRecord,
  MarketingPreviewLiveDeltaRecord,
  MarketingPreviewRemediationActionRecord,
  MarketingPreviewNoteRevisionRecord
} from "./types";
