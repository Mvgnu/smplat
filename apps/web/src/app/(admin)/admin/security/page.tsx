import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminDataTable,
  type AdminDataTableColumn,
  AdminKpiCard,
  AdminTabNav
} from "@/components/admin";
import { requireRole } from "@/server/auth/policies";
import {
  fetchAccessEventMetrics,
  fetchRecentAccessEvents,
  type AccessEventRecord
} from "@/server/security/access-events";

import { ADMIN_PRIMARY_TABS } from "../../admin-tabs";

// meta: page: admin-security

export const metadata: Metadata = {
  title: "Security"
};

const SECURITY_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Security" }
];

const decisionLabels: Record<AccessEventRecord["decision"], string> = {
  allowed: "Allowed",
  denied: "Denied",
  redirected: "Redirected",
  rate_limited: "Rate limited"
};

const decisionTone: Record<AccessEventRecord["decision"], string> = {
  allowed: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/30",
  denied: "bg-rose-500/10 text-rose-200 border border-rose-400/30",
  redirected: "bg-amber-500/10 text-amber-200 border border-amber-400/30",
  rate_limited: "bg-blue-500/10 text-blue-200 border border-blue-400/30"
};

const tierLabels: Record<AccessEventRecord["requiredTier"], string> = {
  admin: "Admin",
  operator: "Operator",
  member: "Member"
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const securityTabs = [
  ...ADMIN_PRIMARY_TABS,
  { label: "Security", href: "/admin/security" }
];

const ACCESS_EVENT_COLUMNS: AdminDataTableColumn<AccessEventRecord>[] = [
  {
    key: "createdAt",
    header: "Captured",
    render: (event) => (
      <div className="flex flex-col">
        <span className="font-semibold text-white">
          {dateTimeFormatter.format(event.createdAt)}
        </span>
        <span className="text-xs text-white/40">{event.route}</span>
      </div>
    )
  },
  {
    key: "method",
    header: "Method",
    width: "7rem",
    render: (event) => (
      <span className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60">
        {event.method ?? "—"}
      </span>
    )
  },
  {
    key: "requiredTier",
    header: "Tier",
    width: "7rem",
    render: (event) => (
      <span className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
        {tierLabels[event.requiredTier] ?? event.requiredTier}
      </span>
    )
  },
  {
    key: "decision",
    header: "Decision",
    width: "9rem",
    render: (event) => (
      <span
        className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${
          decisionTone[event.decision]
        }`}
      >
        {decisionLabels[event.decision]}
      </span>
    )
  },
  {
    key: "subjectEmail",
    header: "Subject",
    render: (event) => {
      const identity = event.subjectEmail ?? event.userId ?? event.serviceAccountId ?? "Unknown";
      return (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">{identity}</span>
          {event.reason ? <span className="text-xs text-white/40">{event.reason}</span> : null}
        </div>
      );
    }
  },
  {
    key: "metadata",
    header: "Metadata",
    render: (event) => (
      <code className="text-xs text-white/50">
        {event.metadata ? JSON.stringify(event.metadata) : "—"}
      </code>
    )
  }
];

export default async function AdminSecurityPage() {
  const { session } = await requireRole("admin", {
    context: {
      route: "admin.security.page",
      method: "GET"
    }
  });

  const [metrics, events] = await Promise.all([
    fetchAccessEventMetrics(24),
    fetchRecentAccessEvents({ limit: 75 })
  ]);

  const highPriorityEvents = events.filter(
    (event) => event.decision !== "allowed" && event.requiredTier !== "member"
  );

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={SECURITY_BREADCRUMBS}
        trailingAction={
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">
            {metrics.windowHours}h window · {metrics.total} events
          </span>
        }
      />
      <AdminTabNav tabs={securityTabs} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard
          label="Denied attempts"
          value={metrics.denied}
          change={{
            direction: metrics.denied > 0 ? "up" : "flat",
            label: metrics.denied > 0 ? `${metrics.denied} flagged` : "Clear"
          }}
          footer={`${metrics.adminDenials} targeting admin surfaces`}
        />
        <AdminKpiCard
          label="Redirected"
          value={metrics.redirected}
          change={{
            direction: metrics.redirected > 0 ? "up" : "flat",
            label: metrics.redirected > 0 ? "Investigate" : "Stable"
          }}
        />
        <AdminKpiCard
          label="Rate limited"
          value={metrics.rateLimited}
          change={{
            direction: metrics.rateLimited > 0 ? "up" : "flat",
            label: metrics.rateLimited > 0 ? "Pressure" : "Calm"
          }}
          footer="Automatic throttles engaged"
        />
        <AdminKpiCard
          label="Unique subjects"
          value={metrics.uniqueSubjects}
          change={{
            direction: metrics.uniqueSubjects > 0 ? "up" : "flat",
            label: metrics.uniqueSubjects > 0 ? "Watchlist" : "Quiet"
          }}
          footer={session.user?.email ? `Visible to ${session.user.email}` : undefined}
        />
      </section>

      <section className="space-y-4">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Escalations to review</h2>
            <p className="text-sm text-white/50">
              Track failed admin promotions or rate limited bursts in near-real time.
            </p>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">
            {highPriorityEvents.length} alerts
          </span>
        </header>
        {highPriorityEvents.length > 0 ? (
          <ol className="space-y-3">
            {highPriorityEvents.slice(0, 8).map((event) => {
              const identity = event.subjectEmail ?? event.userId ?? event.serviceAccountId ?? "Unknown";
              return (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 rounded-3xl border border-white/10 bg-rose-500/5 p-4 text-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{identity}</p>
                    <span className="text-xs text-white/60">
                      {dateTimeFormatter.format(event.createdAt)} · {event.route}
                    </span>
                  </div>
                  <p className="text-xs text-white/60">
                    {decisionLabels[event.decision]} · Required tier {tierLabels[event.requiredTier]}
                  </p>
                  {event.reason ? (
                    <p className="text-xs text-white/50">Reason: {event.reason}</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex min-h-[8rem] items-center justify-center rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-white/60">
            No escalations detected in the current window.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Access trail</h2>
            <p className="text-sm text-white/50">
              Full event stream captured from middleware and role policies. Use metadata to correlate follow-up actions.
            </p>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Latest {events.length}</span>
        </header>
        <AdminDataTable
          columns={ACCESS_EVENT_COLUMNS}
          data={events}
          rowKey={(event) => event.id}
          emptyState={<p>No access activity recorded yet.</p>}
        />
      </section>
    </div>
  );
}
