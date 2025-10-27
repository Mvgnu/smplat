// meta: module: marketing-preview-history-index
// meta: feature: marketing-preview-cockpit

export {
  createHistoryHash,
  buildHistoryAnalytics,
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
  MarketingPreviewHistoryAnalytics,
  MarketingPreviewHistoryEntry,
  MarketingPreviewHistoryNoteSummary,
  MarketingPreviewHistoryQuery,
  MarketingPreviewHistoryQueryResult,
  MarketingPreviewHistoryRouteRecord,
  MarketingPreviewLiveDeltaRecord,
  MarketingPreviewRecommendation,
  MarketingPreviewRegressionVelocity,
  MarketingPreviewRemediationActionRecord,
  MarketingPreviewNoteRevisionRecord,
  MarketingPreviewSeverityMomentum,
  MarketingPreviewTimeToGreenForecast
} from "./types";
