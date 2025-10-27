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
  recordRehearsalAction,
  recordRemediationAction,
  recordNoteRevision,
  getRehearsalAction,
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
  MarketingPreviewRehearsalActionRecord,
  MarketingPreviewNoteRevisionRecord,
  MarketingPreviewSeverityMomentum,
  MarketingPreviewTimeToGreenForecast
} from "./types";
