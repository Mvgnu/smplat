"use client";

// meta: component: BillingCenter
// meta: feature: dashboard-billing

import { Fragment, type ReactNode, useMemo, useState } from "react";
import Link from "next/link";

import {
  AlertCircle,
  ArrowDownToLine,
  BellRing,
  CheckCircle2,
  CreditCard,
  Loader2,
  RotateCcw,
} from "lucide-react";

import type {
  BillingAgingBuckets,
  BillingInvoice,
  BillingSummary,
  CampaignInsight,
  HostedSessionReport,
  InvoiceAdjustment,
  PaymentTimelineEvent,
} from "@/server/billing/types";

import { CampaignIntelligenceGrid } from "./CampaignIntelligenceGrid";
import { HostedSessionJourney } from "./HostedSessionJourney";

type BillingCenterProps = {
  invoices: BillingInvoice[];
  summary: BillingSummary;
  aging: BillingAgingBuckets;
  insights: CampaignInsight[];
  sessionsReport: HostedSessionReport | null;
};

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric"
});

export function BillingCenter({
  invoices,
  summary,
  aging,
  insights,
  sessionsReport,
}: BillingCenterProps) {
  const [notifying, setNotifying] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<{ id: string; type: "capture" | "refund" } | null>(
    null,
  );
  const formatter = useMemo(() => currencyFormatter(summary.currency), [summary.currency]);

  async function handleNotify(invoice: BillingInvoice) {
    if (!invoice.notifyUrl) {
      return;
    }
    try {
      setNotifying(invoice.id);
      const response = await fetch(invoice.notifyUrl, { method: "POST" });
      if (!response.ok) {
        console.warn("Failed to queue invoice reminder", await response.text());
      }
    } catch (error) {
      console.warn("Unexpected error queueing invoice reminder", error);
    } finally {
      setNotifying(null);
    }
  }

  async function handleAction(
    invoice: BillingInvoice,
    action: "capture" | "refund",
    url: string | null,
  ) {
    if (!url) {
      return;
    }
    try {
      setProcessingAction({ id: invoice.id, type: action });
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        console.warn(`Failed to ${action} invoice`, await response.text());
      }
    } catch (error) {
      console.warn(`Unexpected error during invoice ${action}`, error);
    } finally {
      setProcessingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-white">Billing center</h2>
          <p className="text-sm text-white/60">
            Track invoices, outstanding balances, and campaign performance correlations. Exports
            respect workspace scoping and rollout guardrails.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label="Outstanding"
            value={formatter.format(summary.outstandingTotal)}
            tone="default"
            icon={<BellRing className="h-5 w-5" />}
          />
          <SummaryCard
            label="Overdue"
            value={formatter.format(summary.overdueTotal)}
            tone={summary.overdueTotal > 0 ? "danger" : "default"}
            icon={<AlertCircle className="h-5 w-5" />}
          />
          <SummaryCard
            label="Paid to date"
            value={formatter.format(summary.paidTotal)}
            tone="success"
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <table className="min-w-full divide-y divide-white/10 text-sm text-white/70">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-white/40">
              <tr>
                <th className="px-4 py-3 text-left">Invoice</th>
                <th className="px-4 py-3 text-left">Issued</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-white/50">
                    No invoices yet. Once billing rollout enables your workspace, new invoices will
                    appear here automatically.
                  </td>
                </tr>
              )}
              {invoices.map((invoice) => {
                const dueDate = invoice.dueAt ? dateFormatter.format(new Date(invoice.dueAt)) : "";
                const issuedDate = invoice.issuedAt
                  ? dateFormatter.format(new Date(invoice.issuedAt))
                  : "";
                const statusTone = deriveStatusTone(invoice.status);
                const captureInFlight =
                  processingAction?.id === invoice.id && processingAction?.type === "capture";
                const refundInFlight =
                  processingAction?.id === invoice.id && processingAction?.type === "refund";
                const hasPaymentDetails =
                  invoice.paymentTimeline.length > 0 || invoice.adjustments.length > 0;
                return (
                  <Fragment key={invoice.id}>
                    <tr className="hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-white">{invoice.invoiceNumber}</span>
                          {invoice.memo && (
                            <span className="text-xs text-white/50">{invoice.memo}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{issuedDate}</td>
                      <td className="px-4 py-3">{dueDate}</td>
                      <td className="px-4 py-3 text-right">
                        {formatter.format(invoice.total)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatter.format(invoice.balanceDue)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}>
                          {invoice.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link
                            href={invoice.exportUrl}
                            prefetch={false}
                            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/40"
                          >
                            <ArrowDownToLine className="h-4 w-4" /> CSV
                          </Link>
                          {invoice.notifyUrl && (
                            <button
                              type="button"
                              onClick={() => handleNotify(invoice)}
                              disabled={notifying === invoice.id}
                              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {notifying === invoice.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <BellRing className="h-4 w-4" />
                              )}
                              Remind
                            </button>
                          )}
                          {invoice.captureUrl && (
                            <ActionButton
                              label="Capture"
                              icon={<CreditCard className="h-4 w-4" />}
                              onClick={() => handleAction(invoice, "capture", invoice.captureUrl)}
                              disabled={captureInFlight}
                              busy={captureInFlight}
                            />
                          )}
                          {invoice.refundUrl && (
                            <ActionButton
                              label="Refund"
                              tone="danger"
                              icon={<RotateCcw className="h-4 w-4" />}
                              onClick={() => handleAction(invoice, "refund", invoice.refundUrl)}
                              disabled={refundInFlight}
                              busy={refundInFlight}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                    {hasPaymentDetails && (
                      <PaymentDetailRow formatter={formatter} invoice={invoice} />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <AgingCard label="Current" amount={formatter.format(aging.current)} />
          <AgingCard label="30 days" amount={formatter.format(aging.thirty)} />
          <AgingCard label="60 days" amount={formatter.format(aging.sixty)} />
          <AgingCard label="90+ days" amount={formatter.format(aging.ninetyPlus)} />
        </div>

        <CampaignIntelligenceGrid insights={insights} currencyFormatter={formatter} />
      </div>
      </section>

      <HostedSessionJourney report={sessionsReport} />
    </div>
  );
}

type SummaryTone = "default" | "danger" | "success";

type SummaryCardProps = {
  label: string;
  value: string;
  tone: SummaryTone;
  icon: ReactNode;
};

function SummaryCard({ label, value, tone, icon }: SummaryCardProps) {
  const toneStyles: Record<SummaryTone, string> = {
    default: "border-white/15 bg-white/5 text-white",
    danger: "border-red-500/40 bg-red-500/10 text-red-200",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
  };

  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-5 ${toneStyles[tone]}`}>
      <div className="flex items-center gap-2 text-sm uppercase tracking-[0.25em] opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

type AgingCardProps = {
  label: string;
  amount: string;
};

function AgingCard({ label, amount }: AgingCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{amount}</p>
    </div>
  );
}

function deriveStatusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "overdue") {
    return "bg-red-500/10 text-red-200";
  }
  if (normalized === "paid") {
    return "bg-emerald-500/10 text-emerald-200";
  }
  return "bg-white/10 text-white";
}

type ActionButtonProps = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "default" | "danger";
};

function ActionButton({ label, icon, onClick, disabled, busy, tone = "default" }: ActionButtonProps) {
  const toneClasses =
    tone === "danger"
      ? "border-red-500/40 text-red-200 hover:border-red-300/60"
      : "border-white/20 text-white hover:border-white/40";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClasses}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

// meta: ledger-ux: payment-detail-row
type PaymentDetailRowProps = {
  invoice: BillingInvoice;
  formatter: Intl.NumberFormat;
};

function PaymentDetailRow({ invoice, formatter }: PaymentDetailRowProps) {
  return (
    <tr className="bg-white/5 text-xs text-white/60">
      <td colSpan={7} className="px-4 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <PaymentTimeline timeline={invoice.paymentTimeline} formatter={formatter} />
          <AdjustmentSummary
            adjustments={invoice.adjustments}
            formatter={formatter}
            total={invoice.adjustmentsTotal}
          />
        </div>
      </td>
    </tr>
  );
}

type PaymentTimelineProps = {
  timeline: PaymentTimelineEvent[];
  formatter: Intl.NumberFormat;
};

function PaymentTimeline({ timeline, formatter }: PaymentTimelineProps) {
  if (timeline.length === 0) {
    return (
      <div className="flex-1">
        <h4 className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Payment Timeline</h4>
        <p className="mt-2 text-xs text-white/40">Awaiting initial capture.</p>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <h4 className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Payment Timeline</h4>
      <div className="mt-3 flex flex-wrap gap-2">
        {timeline.map((event, index) => (
          <div
            key={`${event.event}-${event.at}-${index}`}
            className="flex flex-col rounded-xl border border-white/10 bg-black/40 px-3 py-2"
          >
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/50">
              {formatTimelineLabel(event.event)}
            </span>
            <span className="text-xs text-white/70">{formatDisplayDate(event.at)}</span>
            {typeof event.amount === "number" && event.amount > 0 && (
              <span className="text-xs font-semibold text-white">
                {formatter.format(event.amount)}
              </span>
            )}
            {event.processorId && (
              <span className="text-[0.65rem] text-white/40">Ref {event.processorId}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type AdjustmentSummaryProps = {
  adjustments: InvoiceAdjustment[];
  formatter: Intl.NumberFormat;
  total: number;
};

function AdjustmentSummary({ adjustments, formatter, total }: AdjustmentSummaryProps) {
  return (
    <div className="flex-1 md:max-w-sm">
      <h4 className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Adjustments</h4>
      {adjustments.length === 0 ? (
        <p className="mt-2 text-xs text-white/40">No adjustments recorded.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {adjustments.map((adjustment, index) => {
            const isCredit = adjustment.type.toLowerCase() === "credit";
            const signedAmount = isCredit ? adjustment.amount * -1 : adjustment.amount;
            return (
              <li
                key={`${adjustment.type}-${index}`}
                className="flex justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white/80">{adjustment.type}</span>
                  {adjustment.memo && <span className="text-[0.65rem] text-white/40">{adjustment.memo}</span>}
                  {adjustment.appliedAt && (
                    <span className="text-[0.65rem] text-white/40">{formatDisplayDate(adjustment.appliedAt)}</span>
                  )}
                </div>
                <span className="text-xs font-semibold text-white">
                  {formatter.format(signedAmount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
        Net Impact: <span className="ml-2 text-xs text-white">{formatter.format(total)}</span>
      </p>
    </div>
  );
}

function formatTimelineLabel(event: string): string {
  const normalized = event.toLowerCase();
  switch (normalized) {
    case "issued":
      return "Invoice Issued";
    case "captured":
      return "Payment Captured";
    case "pending":
      return "Pending";
    case "settled":
      return "Settled";
    case "outstanding":
      return "Outstanding";
    default:
      return normalized.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  }
}

function formatDisplayDate(raw: string): string {
  if (!raw) {
    return "";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
