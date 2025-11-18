import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";

export type OnboardingExperimentEvent = {
  eventId: string;
  journeyId: string;
  orderId: string;
  orderNumber: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
  loyaltyProjectionPoints: number | null;
  slug: string;
  variantKey: string;
  variantName: string | null;
  isControl: boolean | null;
  assignmentStrategy: string | null;
  status: string | null;
  featureFlagKey: string | null;
  recordedAt: string;
};

export type OnboardingExperimentExportResponse = {
  events: OnboardingExperimentEvent[];
  nextCursor: string | null;
};

export type ExperimentTrendSeries = {
  slug: string;
  totalEvents: number;
  latestCount: number;
  sparklinePoints: string;
  labels: { date: string; count: number }[];
};

export type VariantStatusBreakdown = {
  slug: string;
  variantKey: string;
  variantLabel: string;
  active: number;
  stalled: number;
};

export type ExperimentConversionMetric = {
  slug: string;
  orderCount: number;
  journeyCount: number;
  orderTotal: number;
  orderCurrency: string | null;
  loyaltyPoints: number;
  lastActivity: string | null;
};

export type ExperimentConversionSnapshotResponse = {
  metrics: ExperimentConversionMetric[];
  nextCursor: string | null;
  cursor?: string | null;
};

export type QuickOrderFunnelMetrics = {
  startCount: number;
  abortCount: number;
  completeCount: number;
  completionRate: number;
  abortReasons: { reason: string; count: number }[];
  dailySeries: { date: string; starts: number; completes: number }[];
  lastEventAt: string | null;
};

export type GuardrailPlatformContext = {
  id: string;
  label: string;
  handle: string | null;
  platformType: string | null;
};

export type GuardrailAttachmentMetadata = {
  id: string;
  fileName: string;
  assetUrl: string;
  storageKey: string;
  size: number | null;
  contentType: string | null;
  uploadedAt: string | null;
};

export type GuardrailFollowUpAction = "pause" | "resume" | "escalate";

export type GuardrailAlert = {
  id: string;
  providerId: string;
  providerName: string;
  severity: "warning" | "critical";
  detectedAt: string;
  reasons: string[];
  guardrailFailures: number;
  guardrailWarnings: number;
  replayFailures: number;
  replayTotal: number;
  linkHref: string;
  automationHref?: string;
  platformContexts?: GuardrailPlatformContext[];
};

export type GuardrailFollowUpEntry = {
  id: string;
  providerId: string;
  providerName: string | null;
  action: GuardrailFollowUpAction;
  notes: string | null;
  platformContext: GuardrailPlatformContext | null;
  attachments: GuardrailAttachmentMetadata[] | null;
  createdAt: string;
  conversionCursor?: string | null;
  conversionHref?: string | null;
};

export type GuardrailFollowUpStatus = {
  providerId: string;
  providerName: string | null;
  isPaused: boolean;
  lastAction: GuardrailFollowUpAction | string | null;
  updatedAt: string;
  lastFollowUpId: string | null;
};

export type GuardrailFollowUpFeed = {
  entries: GuardrailFollowUpEntry[];
  nextCursor: string | null;
  status: GuardrailFollowUpStatus | null;
  providerTelemetry: ProviderAutomationTelemetry | null;
};

export type GuardrailExportStatus = {
  cursor: string | null;
  rows: number | null;
  updatedAt: string | null;
  downloadUrl: string | null;
  workflowUrl: string | null;
};

export type QuickOrderExportMetrics = {
  startCount: number | null;
  completeCount: number | null;
  abortCount: number | null;
  completionRate: number | null;
};

export type QuickOrderExportStatus = {
  syncedAt: string | null;
  events: number | null;
  downloadUrl: string | null;
  workflowUrl: string | null;
  metrics: QuickOrderExportMetrics | null;
};

export type AutomationWorkflowStatus = {
  workflow: string;
  description: string;
  lastRunAt: string | null;
  durationSeconds: number | null;
  lastRunStatus: "success" | "warning" | "failed";
  nextRunEta: string | null;
  latestCursor: string | null;
  runbookUrl?: string;
  actionUrl?: string;
  summary?: Record<string, unknown> | null;
};

export type ExperimentAnalyticsOverview = {
  trendSeries: ExperimentTrendSeries[];
  variantBreakdown: VariantStatusBreakdown[];
  conversionMetrics: ExperimentConversionMetric[];
  quickOrderFunnel: QuickOrderFunnelMetrics | null;
};

export type GuardrailTelemetryTags = {
  platformSlug: string | null;
  loyaltyTier: string | null;
  experimentSlug: string | null;
  experimentVariant: string | null;
  guardrailStatus: "healthy" | "warning" | "breached" | null;
};

export type TelemetryEventBase = {
  id: string;
  name: string;
  source: "storefront" | "admin" | "automation";
  recordedAt: string;
  guardrail: GuardrailTelemetryTags;
  metadata: Record<string, string | number | boolean | null>;
};

export type GuardrailAlertTelemetryEvent = TelemetryEventBase & {
  name: "guardrail.alert";
  severity: "warning" | "critical";
  targetSlug: string;
  targetVariantKey: string;
};

export type GuardrailAutomationTelemetryEvent = TelemetryEventBase & {
  name: "guardrail.automation";
  action: GuardrailFollowUpAction;
  targetSlug: string;
  targetVariantKey: string;
};

export type ExperimentExposureTelemetryEvent = TelemetryEventBase & {
  name: "experiment.exposure";
  targetSlug: string;
  targetVariantKey: string;
  isControl: boolean | null;
};

export type GuardrailWorkflowTelemetryEvent = TelemetryEventBase & {
  name: "guardrail.workflow";
  workflowAction: string;
  providerId?: string | null;
  providerName?: string | null;
};

export type GuardrailWorkflowTelemetrySummary = {
  totalEvents: number;
  lastCapturedAt: string | null;
  actionCounts: Array<{ action: string; count: number; lastOccurredAt: string | null }>;
  attachmentTotals: {
    upload: number;
    remove: number;
    copy: number;
    tag: number;
  };
  providerActivity: Array<{
    providerId: string | null;
    providerName: string | null;
    lastAction: string;
    lastActionAt: string | null;
    totalActions: number;
  }>;
};

export type QuickOrderTelemetryEventBase = TelemetryEventBase & {
  sessionId: string | null;
  productId: string | null;
  productTitle: string | null;
};

export type QuickOrderStartTelemetryEvent = QuickOrderTelemetryEventBase & {
  name: "quick_order.start";
};

export type QuickOrderAbortTelemetryEvent = QuickOrderTelemetryEventBase & {
  name: "quick_order.abort";
  reason: string | null;
};

export type QuickOrderCompleteTelemetryEvent = QuickOrderTelemetryEventBase & {
  name: "quick_order.complete";
  outcome: "success" | "failure" | null;
};

export type TelemetryEventEnvelope =
  | GuardrailAlertTelemetryEvent
  | GuardrailAutomationTelemetryEvent
  | ExperimentExposureTelemetryEvent
  | GuardrailWorkflowTelemetryEvent
  | QuickOrderStartTelemetryEvent
  | QuickOrderAbortTelemetryEvent
  | QuickOrderCompleteTelemetryEvent;
