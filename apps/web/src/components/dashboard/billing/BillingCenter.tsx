"use client";

// meta: component: BillingCenter
// meta: feature: dashboard-billing

import { type ReactNode, useMemo, useState } from "react";
import Link from "next/link";

import { AlertCircle, ArrowDownToLine, BellRing, CheckCircle2, Loader2 } from "lucide-react";

import type {
  BillingAgingBuckets,
  BillingInvoice,
  BillingSummary,
  CampaignInsight,
} from "@/server/billing/types";

import { CampaignIntelligenceGrid } from "./CampaignIntelligenceGrid";

type BillingCenterProps = {
  invoices: BillingInvoice[];
  summary: BillingSummary;
  aging: BillingAgingBuckets;
  insights: CampaignInsight[];
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

export function BillingCenter({ invoices, summary, aging, insights }: BillingCenterProps) {
  const [notifying, setNotifying] = useState<string | null>(null);
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

  return (
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
                return (
                  <tr key={invoice.id} className="hover:bg-white/5">
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
                      <div className="flex items-center justify-end gap-2">
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
                      </div>
                    </td>
                  </tr>
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
