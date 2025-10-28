"use client";

// meta: component: HostedSessionJourney
// meta: feature: hosted-session-analytics

import { type ReactNode } from "react";
import Link from "next/link";

import { Activity, AlertTriangle, BarChart3, Clock3, RefreshCcw } from "lucide-react";

import type { HostedSessionReport } from "@/server/billing/types";

import { HostedSessionActions } from "./HostedSessionActions";

type HostedSessionJourneyProps = {
  report: HostedSessionReport | null;
};

const percentage = (value: number): string => `${Math.round(value * 100)}%`;

export function HostedSessionJourney({ report }: HostedSessionJourneyProps) {
  if (!report) {
    return (
      <section className="rounded-3xl border border-white/10 bg-black/20 p-6 text-white/60">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-white">Hosted checkout journey</h3>
          <p className="text-sm">
            Hosted checkout analytics are not yet available for this workspace. Sessions will appear once
            hosted checkouts are initiated.
          </p>
        </div>
      </section>
    );
  }

  const lookbackLabel = `${new Date(report.windowStart).toLocaleDateString()} → ${new Date(
    report.windowEnd,
  ).toLocaleDateString()} (${report.lookbackDays}d)`;
  const statusEntries = Object.entries(report.metrics.statusCounts);

  return (
    <section
      className="rounded-3xl border border-white/10 bg-gradient-to-br from-black/40 via-black/20 to-purple-900/20 p-8 text-white"
      data-testid="hosted-session-journey"
    >
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold">Hosted checkout journey</h3>
          <p className="text-sm text-white/60">
            Monitor hosted checkout conversions, recovery cadence, and abandonment patterns alongside invoice
            outcomes.
          </p>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Window {lookbackLabel}</span>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            icon={<BarChart3 className="h-5 w-5" />}
            label="Conversion"
            value={percentage(report.metrics.conversionRate)}
            hint={`${report.metrics.total} sessions`}
          />
          <MetricCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label="Abandonment"
            value={percentage(report.metrics.abandonmentRate)}
            hint={`${report.metrics.pendingRegeneration} queued regenerations`}
          />
          <MetricCard
            icon={<Activity className="h-5 w-5" />}
            label="Retry cadence"
            value={`${report.metrics.averageRetryCount.toFixed(1)} avg retries`}
            hint={`${report.metrics.sessionsWithRetries} sessions retried`}
          />
          <MetricCard
            icon={<Clock3 className="h-5 w-5" />}
            label="Completion time"
            value={formatSeconds(report.metrics.averageCompletionSeconds)}
            hint="avg to convert"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">
              Status distribution
            </h4>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-white/70">
              {statusEntries.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between">
                  <span className="font-medium uppercase tracking-wide text-white/60">{status}</span>
                  <span>{count}</span>
                </li>
              ))}
              {statusEntries.length === 0 && (
                <li className="text-white/50">No hosted sessions recorded in the selected window.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">
                Regeneration insights
              </h4>
              <Link
                href="/dashboard/billing/sessions"
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/40"
              >
                <RefreshCcw className="h-4 w-4" /> Review sessions
              </Link>
            </div>
            <HostedSessionActions report={report} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">
              Abandonment reasons
            </h4>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-white/70">
              {report.abandonmentReasons.length === 0 && (
                <li className="text-white/50">No abandonment reasons recorded in this window.</li>
              )}
              {report.abandonmentReasons.map((reason) => (
                <li key={`${reason.reason}-${reason.count}`} className="flex items-center justify-between">
                  <span className="text-white/60">{reason.reason}</span>
                  <span>{reason.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">
              Invoice status alignment
            </h4>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-white/70">
              {report.invoiceStatuses.length === 0 && (
                <li className="text-white/50">No invoices matched hosted sessions in this window.</li>
              )}
              {report.invoiceStatuses.map((entry) => (
                <li key={entry.status} className="flex items-center justify-between">
                  <span className="uppercase tracking-wide text-white/60">{entry.status}</span>
                  <span>{entry.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatSeconds(value: number | null): string {
  if (!value) {
    return "n/a";
  }
  const minutes = Math.floor(value / 60);
  if (minutes < 1) {
    return `${Math.round(value)}s`;
  }
  return `${minutes}m`;
}

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
};

function MetricCard({ icon, label, value, hint }: MetricCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/30 p-5">
      <div className="flex items-center gap-3 text-white/60">
        <span className="rounded-full bg-white/10 p-2 text-white">{icon}</span>
        <span className="text-sm font-medium uppercase tracking-[0.2em]">{label}</span>
      </div>
      <span className="text-2xl font-semibold text-white">{value}</span>
      <span className="text-xs text-white/50">{hint}</span>
    </div>
  );
}
