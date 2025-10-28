import "server-only";

import type { InstagramAccountAnalytics } from "@/server/instagram/analytics";

import type {
  BillingAgingBuckets,
  BillingCenterPayload,
  BillingInvoice,
  BillingInvoiceLineItem,
  BillingSummary,
  CampaignInsight,
  HostedSessionReport,
  HostedSessionRecoveryTimeline,
} from "./types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

type ClientOrderSummary = {
  id: string;
  status: string;
  total: number;
};

type RawInvoiceResponse = {
  invoices: Array<{
    id: string;
    invoice_number: string;
    status: string;
    currency: string;
    subtotal: number;
    tax: number;
    total: number;
    balance_due: number;
    paymentIntentId?: string | null;
    externalProcessorId?: string | null;
    settlementAt?: string | null;
    adjustmentsTotal?: number;
    adjustments?: Array<Record<string, unknown>> | null;
    paymentTimeline?: Array<Record<string, unknown>> | null;
    issued_at: string;
    due_at: string;
    paid_at: string | null;
    memo: string | null;
    line_items: Array<{
      id: string;
      description: string;
      quantity: number;
      unit_amount: number;
      total_amount: number;
      order_id: string | null;
      campaign_reference: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  }>;
  summary: {
    currency: string;
    outstanding_total: number;
    overdue_total: number;
    paid_total: number;
  };
  aging: {
    current: number;
    thirty: number;
    sixty: number;
    ninetyPlus: number;
  };
};

type BillingFetchOptions = {
  workspaceId: string;
  orders: ClientOrderSummary[];
  instagram: InstagramAccountAnalytics[];
};

const emptyPayload: BillingCenterPayload = {
  invoices: [],
  summary: {
    currency: "EUR",
    outstandingTotal: 0,
    overdueTotal: 0,
    paidTotal: 0,
  },
  aging: {
    current: 0,
    thirty: 0,
    sixty: 0,
    ninetyPlus: 0,
  },
  insights: [],
  sessionsReport: null,
  recoveryTimeline: null,
};

type RawHostedSessionReport = {
  workspaceId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  lookbackDays: number;
  metrics: {
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
  abandonmentReasons: Array<{ reason: string; count: number }>;
  invoiceStatuses: Array<{ status: string; count: number }>;
};

type RawHostedSessionListResponse = {
  sessions: Array<{
    id: string;
    sessionId: string;
    status: string;
    metadata: Record<string, unknown> | null;
    recoveryState?: {
      attempts?: Array<{
        attempt: number;
        status: string;
        scheduledAt?: string;
        nextRetryAt?: string | null;
        notifiedAt?: string | null;
      }>;
      nextRetryAt?: string | null;
      lastNotifiedAt?: string | null;
      lastChannel?: string | null;
    } | null;
  }>;
};

export async function fetchBillingCenterPayload({
  workspaceId,
  orders,
  instagram,
}: BillingFetchOptions): Promise<BillingCenterPayload> {
  if (!workspaceId) {
    return emptyPayload;
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; billing center is disabled.");
    return emptyPayload;
  }

  try {
    const [invoicesResponse, reportsResponse, sessionsResponse] = await Promise.all([
      fetch(
        `${apiBaseUrl}/api/v1/billing/invoices?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          headers: {
            "X-API-Key": checkoutApiKey,
          },
          cache: "no-store",
        },
      ),
      fetch(
        `${apiBaseUrl}/api/v1/billing/reports?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: {
            "X-API-Key": checkoutApiKey,
          },
          cache: "no-store",
        },
      ),
      fetch(
        `${apiBaseUrl}/api/v1/billing/sessions?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: {
            "X-API-Key": checkoutApiKey,
          },
          cache: "no-store",
        },
      ),
    ]);

    if (!invoicesResponse.ok) {
      if (invoicesResponse.status !== 404) {
        console.warn("Failed to fetch billing invoices", invoicesResponse.status);
      }
      return emptyPayload;
    }

    const payload = (await invoicesResponse.json()) as RawInvoiceResponse;
    const invoices = payload.invoices.map((invoice) =>
      normalizeInvoice(invoice, workspaceId),
    );
    const summary = normalizeSummary(payload.summary);
    const aging = normalizeAging(payload.aging);
    const insights = buildInsights(invoices, orders, instagram);
    const sessionsReport = await normalizeHostedSessionsReport(reportsResponse);
    const recoveryTimeline = await normalizeRecoveryTimeline(workspaceId, sessionsResponse);

    return { invoices, summary, aging, insights, sessionsReport, recoveryTimeline };
  } catch (error) {
    console.warn("Unexpected error fetching billing data", error);
    return emptyPayload;
  }
}

function normalizeInvoice(invoice: RawInvoiceResponse["invoices"][number], workspaceId: string): BillingInvoice {
  const lineItems: BillingInvoiceLineItem[] = invoice.line_items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    unitAmount: item.unit_amount,
    totalAmount: item.total_amount,
    orderId: item.order_id,
    campaignReference: item.campaign_reference,
  }));

  const paymentTimeline = (invoice.paymentTimeline ?? []).map((entry) => ({
    event: String(entry.event ?? entry["event"] ?? "unknown"),
    at: String(entry.at ?? entry["at"] ?? ""),
    amount: typeof entry.amount === "number" ? entry.amount : Number(entry.amount ?? 0) || undefined,
    processorId: entry.processor_id ? String(entry.processor_id) : entry.processorId ? String(entry.processorId) : undefined,
  }));

  const adjustments = (invoice.adjustments ?? []).map((entry) => ({
    type: String(entry.type ?? entry["type"] ?? "adjustment"),
    amount: typeof entry.amount === "number" ? entry.amount : Number(entry.amount ?? 0),
    memo: entry.memo ? String(entry.memo) : undefined,
    appliedAt: entry.applied_at ? String(entry.applied_at) : entry.appliedAt ? String(entry.appliedAt) : undefined,
  }));

  const exportUrl = `/api/billing/${invoice.id}/export?workspaceId=${encodeURIComponent(
    workspaceId,
  )}&format=csv`;
  const notifyUrl = invoice.balance_due > 0
    ? `/api/billing/${invoice.id}/notify?workspaceId=${encodeURIComponent(workspaceId)}`
    : null;
  const captureUrl = invoice.balance_due > 0
    ? `/api/billing/${invoice.id}/capture?workspaceId=${encodeURIComponent(workspaceId)}`
    : null;
  const hasSettleableEvent = paymentTimeline.some((entry) => entry.event !== "issued");
  const refundUrl = hasSettleableEvent
    ? `/api/billing/${invoice.id}/refund?workspaceId=${encodeURIComponent(workspaceId)}`
    : null;

  const settlementAt = invoice.settlementAt ?? invoice.settlement_at ?? null;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    balanceDue: invoice.balance_due,
    paymentIntentId: invoice.paymentIntentId ?? invoice.payment_intent_id ?? null,
    externalProcessorId: invoice.externalProcessorId ?? invoice.external_processor_id ?? null,
    settlementAt,
    adjustmentsTotal: invoice.adjustmentsTotal ?? invoice.adjustments_total ?? 0,
    adjustments,
    paymentTimeline,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    paidAt: invoice.paid_at,
    memo: invoice.memo,
    exportUrl,
    notifyUrl,
    captureUrl,
    refundUrl,
    lineItems,
  };
}

function normalizeSummary(summary: RawInvoiceResponse["summary"]): BillingSummary {
  return {
    currency: summary.currency,
    outstandingTotal: summary.outstanding_total,
    overdueTotal: summary.overdue_total,
    paidTotal: summary.paid_total,
  };
}

function normalizeAging(aging: RawInvoiceResponse["aging"]): BillingAgingBuckets {
  return {
    current: aging.current,
    thirty: aging.thirty,
    sixty: aging.sixty,
    ninetyPlus: aging.ninetyPlus,
  };
}

function buildInsights(
  invoices: BillingInvoice[],
  orders: ClientOrderSummary[],
  instagram: InstagramAccountAnalytics[],
): CampaignInsight[] {
  if (invoices.length === 0) {
    return [];
  }

  const orderStatus = new Map(orders.map((order) => [order.id, order.status]));
  const orderTotals = new Map(orders.map((order) => [order.id, order.total]));
  const reachDelta = computeAverageReachDelta(instagram);

  return invoices.map((invoice) => {
    const relatedOrderIds = new Set(
      invoice.lineItems
        .map((line) => line.orderId)
        .filter((value): value is string => Boolean(value)),
    );
    const relatedOrders = [...relatedOrderIds].map((id) => ({
      status: (orderStatus.get(id) ?? "unknown").toLowerCase(),
      total: orderTotals.get(id) ?? 0,
    }));

    const completed = relatedOrders.filter((order) => order.status === "completed").length;
    const successRate = relatedOrders.length > 0 ? completed / relatedOrders.length : 1;
    const campaignName =
      invoice.lineItems.find((line) => line.campaignReference)?.campaignReference ??
      `Invoice ${invoice.invoiceNumber}`;

    const commentary = buildCommentary({
      campaignName,
      invoiceTotal: invoice.total,
      successRate,
      reachDelta,
      completed,
      totalOrders: relatedOrders.length,
    });

    return {
      invoiceId: invoice.id,
      campaign: campaignName,
      spend: invoice.total,
      reachDelta,
      fulfillmentSuccessRate: successRate,
      commentary,
    } satisfies CampaignInsight;
  });
}

function computeAverageReachDelta(instagram: InstagramAccountAnalytics[]): number {
  if (instagram.length === 0) {
    return 0;
  }

  const deltas = instagram.map((account) => {
    if (account.history.length < 2) {
      return 0;
    }
    const first = account.history[0];
    const last = account.history[account.history.length - 1];
    if (!first || !last || first.reach === 0) {
      return 0;
    }
    return ((last.reach - first.reach) / first.reach) * 100;
  });

  const aggregate = deltas.reduce((sum, value) => sum + value, 0);
  return deltas.length > 0 ? aggregate / deltas.length : 0;
}

function buildCommentary({
  campaignName,
  invoiceTotal,
  successRate,
  reachDelta,
  completed,
  totalOrders,
}: {
  campaignName: string;
  invoiceTotal: number;
  successRate: number;
  reachDelta: number;
  completed: number;
  totalOrders: number;
}): string {
  const successPercent = Math.round(successRate * 100);
  const reachDescriptor = reachDelta === 0 ? "steady" : `${reachDelta.toFixed(1)}% reach delta`;
  const fulfillmentSummary =
    totalOrders > 0 ? `${completed}/${totalOrders} orders completed` : "no linked orders";

  return `${campaignName} captured ${reachDescriptor} and ${successPercent}% fulfillment success (${fulfillmentSummary}). Spend tracked: €${invoiceTotal.toFixed(
    2,
  )}.`;
}

async function normalizeHostedSessionsReport(
  response: Response,
): Promise<HostedSessionReport | null> {
  if (!response.ok) {
    if (response.status !== 404) {
      console.warn("Failed to fetch hosted session report", response.status);
    }
    return null;
  }

  try {
    const raw = (await response.json()) as RawHostedSessionReport;
    return {
      workspaceId: raw.workspaceId,
      generatedAt: raw.generatedAt,
      windowStart: raw.windowStart,
      windowEnd: raw.windowEnd,
      lookbackDays: raw.lookbackDays,
      metrics: {
        total: raw.metrics.total,
        statusCounts: raw.metrics.statusCounts,
        conversionRate: raw.metrics.conversionRate,
        abandonmentRate: raw.metrics.abandonmentRate,
        averageCompletionSeconds: raw.metrics.averageCompletionSeconds,
        averageRetryCount: raw.metrics.averageRetryCount,
        sessionsWithRetries: raw.metrics.sessionsWithRetries,
        averageRetryLatencySeconds: raw.metrics.averageRetryLatencySeconds,
        pendingRegeneration: raw.metrics.pendingRegeneration,
      },
      abandonmentReasons: raw.abandonmentReasons,
      invoiceStatuses: raw.invoiceStatuses,
    } satisfies HostedSessionReport;
  } catch (error) {
    console.warn("Failed to parse hosted session report", error);
    return null;
  }
}

async function normalizeRecoveryTimeline(
  workspaceId: string,
  response: Response,
): Promise<HostedSessionRecoveryTimeline | null> {
  if (!response.ok) {
    if (response.status !== 404) {
      console.warn("Failed to fetch hosted session recovery data", response.status);
    }
    return null;
  }

  try {
    const raw = (await response.json()) as RawHostedSessionListResponse;
    const sessions = raw.sessions
      .map((session) => {
        const metadata = (session.metadata ?? {}) as Record<string, unknown>;
        const communicationLog = Array.isArray(metadata.communication_log)
          ? (metadata.communication_log as Array<Record<string, unknown>>)
          : [];
        const attempts = (session.recoveryState?.attempts ?? []).map((attempt) => ({
          attempt: Number(attempt.attempt ?? 0),
          status: String(attempt.status ?? session.status ?? "unknown"),
          scheduledAt: String(
            (attempt as Record<string, unknown>).scheduledAt ??
              (attempt as Record<string, unknown>).scheduled_at ??
              "",
          ),
          nextRetryAt:
            typeof (attempt as Record<string, unknown>).nextRetryAt === "string"
              ? String((attempt as Record<string, unknown>).nextRetryAt)
              : typeof (attempt as Record<string, unknown>).next_retry_at === "string"
              ? String((attempt as Record<string, unknown>).next_retry_at)
              : null,
          notifiedAt:
            typeof (attempt as Record<string, unknown>).notifiedAt === "string"
              ? String((attempt as Record<string, unknown>).notifiedAt)
              : typeof (attempt as Record<string, unknown>).notified_at === "string"
              ? String((attempt as Record<string, unknown>).notified_at)
              : null,
        }));
        const lastNotified =
          session.recoveryState?.lastNotifiedAt ??
          (typeof metadata.last_notified_at === "string" ? metadata.last_notified_at : null);
        const nextRetry =
          session.recoveryState?.nextRetryAt ??
          (typeof metadata.next_retry_at === "string" ? metadata.next_retry_at : null);
        const lastChannel =
          session.recoveryState?.lastChannel ??
          (communicationLog.length > 0
            ? String(communicationLog[communicationLog.length - 1]?.channel ?? "")
            : null);
        return {
          sessionId: session.sessionId,
          status: session.status,
          attempts,
          lastNotifiedAt: lastNotified,
          nextRetryAt: nextRetry,
          lastChannel,
        };
      })
      .filter(
        (entry) =>
          entry.attempts.length > 0 || entry.lastNotifiedAt !== null || entry.nextRetryAt !== null,
      );

    if (sessions.length === 0) {
      return null;
    }

    return {
      workspaceId,
      generatedAt: new Date().toISOString(),
      sessions,
    } satisfies HostedSessionRecoveryTimeline;
  } catch (error) {
    console.warn("Failed to parse hosted session recovery response", error);
    return null;
  }
}

