import Link from "next/link";

import {
  fetchOperatorJourneyDetail,
  fetchOperatorJourneys,
  type OperatorJourneySummary,
} from "@/server/onboarding/journeys";

import { ManualNudgeForm } from "./manual-nudge-form";

// meta: route: admin/onboarding

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const riskTone: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-200 border border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
};

const statusTone: Record<string, string> = {
  active: "bg-blue-500/15 text-blue-100 border border-blue-500/30",
  stalled: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
};

type AdminOnboardingPageProps = {
  searchParams?: {
    journeyId?: string;
    stalled?: string;
    referrals?: string;
  };
};

function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return dateFormatter.format(new Date(value));
}

function journeyLink(summary: OperatorJourneySummary, selected: boolean) {
  return (
    <Link
      href={`/admin/onboarding?journeyId=${summary.journeyId}`}
      className={`flex flex-col gap-2 rounded-2xl border border-white/10 p-4 transition hover:border-white/20 ${selected ? "bg-white/10" : "bg-black/30"}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">
          {summary.orderNumber ?? summary.orderId.slice(0, 8)}
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusTone[summary.status] ?? "bg-white/10 text-white/70 border border-white/20"}`}>
          {summary.status.replace("_", " ")}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>Progress {formatPercentage(summary.progressPercentage)}</span>
        <span>Updated {formatDate(summary.updatedAt)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{summary.totalTasks - summary.completedTasks} tasks open</span>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${riskTone[summary.riskLevel] ?? "bg-white/10 text-white/70 border border-white/20"}`}>
          {summary.riskLevel} risk
        </span>
      </div>
    </Link>
  );
}

export const metadata = {
  title: "Onboarding",
};

export default async function AdminOnboardingPage({ searchParams }: AdminOnboardingPageProps) {
  const showStalledOnly = searchParams?.stalled === "true";
  const showReferralsOnly = searchParams?.referrals === "true";

  const { summaries, aggregates } = await fetchOperatorJourneys({
    stalled: showStalledOnly,
    referrals: showReferralsOnly,
  });

  if (summaries.length === 0) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Operations</p>
          <h1 className="mt-2 text-3xl font-semibold">Onboarding journeys</h1>
          <p className="mt-3 text-white/70">
            Concierge visibility, stalled-task filters, and referral tracking will show up here as soon as the first orders complete checkout.
          </p>
        </header>
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center text-white/60 backdrop-blur">
          No onboarding journeys yet.
        </section>
      </main>
    );
  }

  const requestedJourneyId = searchParams?.journeyId ?? null;
  const selectedJourneyId = requestedJourneyId && summaries.some((entry) => entry.journeyId === requestedJourneyId)
    ? requestedJourneyId
    : summaries[0].journeyId;

  const detail = await fetchOperatorJourneyDetail(selectedJourneyId);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Operations</p>
        <h1 className="text-3xl font-semibold">Onboarding command center</h1>
        <p className="text-white/70">
          Monitor onboarding journeys, surface stalled workflows, and trigger concierge nudges directly from the operator console.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Journeys" value={aggregates.total} />
        <StatCard label="Active" value={aggregates.active} />
        <StatCard label="Stalled" value={aggregates.stalled} tone="warning" />
        <StatCard label="Referral journeys" value={aggregates.withReferrals} tone="accent" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[2fr,3fr]">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Journeys</h2>
            <div className="flex gap-3 text-xs text-white/60">
              <Link
                href="/admin/onboarding"
                className={!showStalledOnly && !showReferralsOnly ? "font-semibold text-white" : "hover:text-white"}
              >
                All
              </Link>
              <Link
                href="/admin/onboarding?stalled=true"
                className={showStalledOnly ? "font-semibold text-white" : "hover:text-white"}
              >
                Stalled
              </Link>
              <Link
                href="/admin/onboarding?referrals=true"
                className={showReferralsOnly ? "font-semibold text-white" : "hover:text-white"}
              >
                Referrals
              </Link>
            </div>
          </div>
          <div className="grid gap-3">
            {summaries.map((summary) => journeyLink(summary, summary.journeyId === selectedJourneyId))}
          </div>
        </section>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Journey</p>
              <h2 className="text-2xl font-semibold text-white">
                {detail.orderNumber ?? detail.orderId.slice(0, 8)}
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/60">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusTone[detail.status] ?? "bg-white/10 text-white/70 border border-white/20"}`}>
                {detail.status.replace("_", " ")}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${riskTone[detail.riskLevel] ?? "bg-white/10 text-white/70 border border-white/20"}`}>
                {detail.riskLevel} risk
              </span>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryTile label="Progress" value={formatPercentage(detail.progressPercentage)} />
            <SummaryTile label="Referral" value={detail.referralCode ?? "—"} />
            <SummaryTile label="Started" value={formatDate(detail.startedAt)} />
            <SummaryTile label="Updated" value={formatDate(detail.updatedAt)} />
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Tasks</h3>
            <div className="space-y-2">
              {detail.tasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between text-sm text-white">
                    <p className="font-semibold">{task.title}</p>
                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">{task.status}</span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
                    <p>Due: {formatDate(task.dueAt)}</p>
                    <p>Completed: {formatDate(task.completedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Recent interactions</h3>
            <div className="space-y-3">
              {detail.interactions.slice(0, 6).map((interaction) => (
                <article key={interaction.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>{interaction.actor} via {interaction.channel}</span>
                    <span>{formatDate(interaction.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{interaction.summary ?? "Interaction"}</p>
                  {interaction.details && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs text-white/60">
                      {interaction.details}
                    </pre>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Concierge nudges</h3>
            {detail.nudgeOpportunities.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-white/60">
                No automated nudges pending for this journey.
              </p>
            ) : (
              <div className="space-y-3">
                {detail.nudgeOpportunities.map((opportunity) => (
                  <article key={opportunity.dedupeKey} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-50">
                    <header className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-amber-200/80">
                      <span>{opportunity.reason.replace("_", " ")}</span>
                      <span>{opportunity.recommendedChannel}</span>
                    </header>
                    <p className="mt-2 font-semibold text-amber-50">{opportunity.subject}</p>
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-amber-100/80">{opportunity.message}</pre>
                    <p className="mt-3 text-[11px] uppercase tracking-[0.3em] text-amber-200/70">
                      SLA expires {formatDate(opportunity.slaExpiresAt)} • Idle {opportunity.idleHours}h
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <ManualNudgeForm
            journeyId={detail.journeyId}
            tasks={detail.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status }))}
          />
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warning" | "accent" }) {
  const palette = {
    warning: "border-amber-400/30 bg-amber-500/10 text-amber-100",
    accent: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  } as const;
  const base = "rounded-2xl border border-white/10 bg-black/30 p-4 text-white";
  const toneClass = tone ? palette[tone] ?? "" : "";

  return (
    <div className={`${base} ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
