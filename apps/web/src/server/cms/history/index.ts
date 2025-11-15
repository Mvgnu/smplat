// meta: module: marketing-preview-history-index
// meta: feature: marketing-preview-cockpit

export {
  createHistoryHash,
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
export { buildHistoryAnalytics } from "./analytics";
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
  MarketingPreviewRehearsalComparison,
  MarketingPreviewRehearsalFailureReason,
  MarketingPreviewRehearsalVerdict,
  MarketingPreviewNoteRevisionRecord,
  MarketingPreviewSeverityMomentum,
  MarketingPreviewTimeToGreenForecast
} from "./types";
