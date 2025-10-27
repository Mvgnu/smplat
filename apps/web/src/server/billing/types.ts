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

export type BillingInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  balanceDue: number;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  memo: string | null;
  exportUrl: string;
  notifyUrl: string | null;
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
