import "server-only";

import type { InstagramAccountAnalytics } from "@/server/instagram/analytics";

import type {
  BillingAgingBuckets,
  BillingCenterPayload,
  BillingInvoice,
  BillingInvoiceLineItem,
  BillingSummary,
  CampaignInsight,
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
    const response = await fetch(
      `${apiBaseUrl}/api/v1/billing/invoices?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        headers: {
          "X-API-Key": checkoutApiKey,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn("Failed to fetch billing invoices", response.status);
      }
      return emptyPayload;
    }

    const payload = (await response.json()) as RawInvoiceResponse;
    const invoices = payload.invoices.map((invoice) =>
      normalizeInvoice(invoice, workspaceId),
    );
    const summary = normalizeSummary(payload.summary);
    const aging = normalizeAging(payload.aging);
    const insights = buildInsights(invoices, orders, instagram);

    return { invoices, summary, aging, insights };
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

  const exportUrl = `/api/billing/${invoice.id}/export?workspaceId=${encodeURIComponent(
    workspaceId,
  )}&format=csv`;
  const notifyUrl = invoice.balance_due > 0
    ? `/api/billing/${invoice.id}/notify?workspaceId=${encodeURIComponent(workspaceId)}`
    : null;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    balanceDue: invoice.balance_due,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    paidAt: invoice.paid_at,
    memo: invoice.memo,
    exportUrl,
    notifyUrl,
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
