import "server-only";

export type BillingInvoiceLineItem = {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  orderId: string | null;
  campaignReference: string | null;
};

export type PaymentTimelineEvent = {
  event: string;
  at: string;
  amount?: number;
  processorId?: string;
};

export type InvoiceAdjustment = {
  type: string;
  amount: number;
  memo?: string;
  appliedAt?: string;
};

export type BillingInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  balanceDue: number;
  paymentIntentId: string | null;
  externalProcessorId: string | null;
  settlementAt: string | null;
  adjustmentsTotal: number;
  adjustments: InvoiceAdjustment[];
  paymentTimeline: PaymentTimelineEvent[];
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  memo: string | null;
  exportUrl: string;
  notifyUrl: string | null;
  captureUrl: string | null;
  refundUrl: string | null;
  lineItems: BillingInvoiceLineItem[];
};

export type BillingSummary = {
  currency: string;
  outstandingTotal: number;
  overdueTotal: number;
  paidTotal: number;
};

export type BillingAgingBuckets = {
  current: number;
  thirty: number;
  sixty: number;
  ninetyPlus: number;
};

export type CampaignInsight = {
  invoiceId: string;
  campaign: string;
  spend: number;
  reachDelta: number;
  fulfillmentSuccessRate: number;
  commentary: string;
};

// meta: billing-report: types

export type HostedSessionMetrics = {
  total: number;
  statusCounts: Record<string, number>;
  conversionRate: number;
  abandonmentRate: number;
  averageCompletionSeconds: number | null;
  averageRetryCount: number;
  sessionsWithRetries: number;
  averageRetryLatencySeconds: number | null;
  pendingRegeneration: number;
};

export type HostedSessionReason = {
  reason: string;
  count: number;
};

export type HostedSessionInvoiceRollup = {
  status: string;
  count: number;
};

export type HostedSessionReport = {
  workspaceId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  lookbackDays: number;
  metrics: HostedSessionMetrics;
  abandonmentReasons: HostedSessionReason[];
  invoiceStatuses: HostedSessionInvoiceRollup[];
};

export type BillingCenterPayload = {
  invoices: BillingInvoice[];
  summary: BillingSummary;
  aging: BillingAgingBuckets;
  insights: CampaignInsight[];
  sessionsReport: HostedSessionReport | null;
};

export type ReconciliationRunMetrics = {
  status: string;
  persisted: number;
  updated: number;
  staged: number;
  removed: number;
  disputes: number;
  cursor: string | null;
  error?: string | null;
};

export type ReconciliationRunFailure = {
  status: string;
  error: string;
  staged: number;
  persisted: number;
  updated: number;
  removed: number;
  disputes: number;
  cursor: string | null;
};

export type ReconciliationRun = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  totalTransactions: number;
  matchedTransactions: number;
  discrepancyCount: number;
  notes: string | null;
  metrics: ReconciliationRunMetrics | null;
  failure: ReconciliationRunFailure | null;
};

export type ReconciliationDiscrepancy = {
  id: string;
  runId: string;
  invoiceId: string | null;
  processorStatementId: string | null;
  transactionId: string | null;
  discrepancyType: string;
  status: string;
  amountDelta: number | null;
  summary: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  playbook: {
    recommendedActions: string[];
    autoResolveThreshold: number | null;
    escalationAfterHours: number | null;
    notes: string | null;
  } | null;
};

export type ReconciliationStagingEntry = {
  id: string;
  transactionId: string;
  processor: string;
  reason: string;
  status: string;
  triageNote: string | null;
  requeueCount: number;
  workspaceHint: string | null;
  payload: Record<string, unknown> | null;
  firstObservedAt: string;
  lastObservedAt: string;
  lastTriagedAt: string | null;
  resolvedAt: string | null;
};

export type ReconciliationDashboard = {
  runs: ReconciliationRun[];
  discrepancies: ReconciliationDiscrepancy[];
  staging: ReconciliationStagingEntry[];
  stagingBacklog: number;
};

export type ProcessorReplayStatus =
  | "pending"
  | "queued"
  | "in-progress"
  | "succeeded"
  | "failed";

export type ProcessorReplayEvent = {
  id: string;
  provider: string;
  externalId: string;
  correlationId: string | null;
  workspaceId: string | null;
  invoiceId: string | null;
  replayRequested: boolean;
  replayRequestedAt: string | null;
  replayAttempts: number;
  replayedAt: string | null;
  lastReplayError: string | null;
  receivedAt: string;
  createdAt: string;
  status: ProcessorReplayStatus;
};

export type ProcessorReplayFilters = {
  provider?: string;
  status?: ProcessorReplayStatus | "all";
  correlationId?: string;
  limit?: number;
  workspaceId?: string | "all";
  since?: string;
};

export type ProcessorReplayAttempt = {
  id: string;
  attemptedAt: string;
  status: "succeeded" | "failed" | string;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

export type ProcessorReplayDetail = ProcessorReplayEvent & {
  attempts: ProcessorReplayAttempt[];
  invoiceSnapshot: {
    id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    issuedAt: string;
    dueAt: string;
  } | null;
};
