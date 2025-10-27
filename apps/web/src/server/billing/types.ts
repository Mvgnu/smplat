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

export type BillingCenterPayload = {
  invoices: BillingInvoice[];
  summary: BillingSummary;
  aging: BillingAgingBuckets;
  insights: CampaignInsight[];
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
