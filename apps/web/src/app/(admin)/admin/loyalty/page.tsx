import { AdminBreadcrumbs, AdminDataTable, type AdminDataTableColumn, AdminKpiCard, AdminTabNav } from "@/components/admin";

import { getOrCreateCsrfToken } from "@/server/security/csrf";
import { fetchGuardrailSnapshot } from "@/server/loyalty/guardrails";

import { ADMIN_PRIMARY_TABS } from "@/app/(admin)/admin-tabs";
import { GuardrailOverrideForm } from "./guardrail-override-form";

// meta: route: admin/loyalty

type GuardrailRow = {
  key: string;
  status: "healthy" | "warning" | "breached";
  threshold: string;
  lastOverride?: string;
};

const STATUS_BADGE: Record<GuardrailRow["status"], string> = {
  healthy: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  warning: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  breached: "border-rose-400/30 bg-rose-500/10 text-rose-100"
};

const GUARDRAIL_COLUMNS: AdminDataTableColumn<GuardrailRow>[] = [
  { key: "key", header: "Guardrail" },
  { key: "threshold", header: "Threshold" },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase tracking-[0.3em] ${STATUS_BADGE[row.status]}`}>
        {row.status}
      </span>
    )
  },
  {
    key: "lastOverride",
    header: "Last override",
    render: (row) => <span className="text-sm text-white/60">{row.lastOverride ?? "—"}</span>
  }
];

const LOYALTY_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Loyalty" }
];

function buildGuardrailRows(snapshot: Awaited<ReturnType<typeof fetchGuardrailSnapshot>>): GuardrailRow[] {
  const inviteOverride = snapshot.overrides.find((override) => override.scope === "invite_quota");
  const cooldownOverride = snapshot.overrides.find((override) => override.scope === "invite_cooldown");
  const throttleOverride = snapshot.overrides.find((override) => override.scope === "global_throttle");

  const formatOverride = (label: string | undefined) => label ?? "—";

  return [
    {
      key: "Invite quota",
      status: snapshot.membersAtQuota > 0 ? "warning" : "healthy",
      threshold: `${snapshot.inviteQuota} active invites`,
      lastOverride: formatOverride(inviteOverride?.justification)
    },
    {
      key: "Referral cooldown",
      status: snapshot.cooldownRemainingSeconds && snapshot.cooldownRemainingSeconds > 0 ? "warning" : "healthy",
      threshold: `${Math.round(snapshot.cooldownSeconds / 60)} min window`,
      lastOverride: formatOverride(cooldownOverride?.justification)
    },
    {
      key: "Global throttle",
      status: snapshot.throttleOverrideActive ? "breached" : "healthy",
      threshold: snapshot.throttleOverrideActive ? "Paused via override" : "Automation",
      lastOverride: formatOverride(throttleOverride?.justification)
    }
  ];
}

export default async function AdminLoyaltyPage() {
  const [snapshot, csrfToken] = await Promise.all([fetchGuardrailSnapshot(), Promise.resolve(getOrCreateCsrfToken())]);

  const guardrailRows = buildGuardrailRows(snapshot);
  const activeOverrides = snapshot.overrides.filter((override) => override.isActive).length;

  return (
    <div className="space-y-8" data-testid="guardrail-console">
      <AdminBreadcrumbs
        items={LOYALTY_BREADCRUMBS}
        trailingAction={<span className="text-xs uppercase tracking-[0.3em] text-white/40">API polled live</span>}
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="guardrail-kpis">
        <AdminKpiCard
          label="Active overrides"
          value={activeOverrides}
          footer={activeOverrides > 0 ? "Review audit trail" : "No manual overrides"}
        />
        <AdminKpiCard
          label="Members at quota"
          value={snapshot.membersAtQuota}
          footer={snapshot.membersAtQuota > 0 ? "Investigate invite backlog" : "Capacity available"}
        />
        <AdminKpiCard
          label="Active invites"
          value={snapshot.totalActiveInvites}
          footer={`Quota ${snapshot.inviteQuota}`}
        />
        <AdminKpiCard
          label="Cooldown remaining"
          value={snapshot.cooldownRemainingSeconds ? `${Math.ceil(snapshot.cooldownRemainingSeconds / 60)}m` : "Clear"}
          footer={snapshot.cooldownUntil ? `Unlocks ${new Date(snapshot.cooldownUntil).toLocaleTimeString()}` : "Ready"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-white">Guardrail posture</h2>
            <p className="text-sm text-white/60">
              Live snapshot of referral guardrails with override context and throttle state awareness.
            </p>
          </div>
          <AdminDataTable columns={GUARDRAIL_COLUMNS} data={guardrailRows} rowKey={(row) => row.key} />

          <div className="space-y-3" data-testid="guardrail-override-list">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/60">Recent overrides</h3>
            {snapshot.overrides.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                No overrides recorded in the current window.
              </p>
            ) : (
              <ul className="space-y-3 text-sm text-white/70">
                {snapshot.overrides.map((override) => {
                  const noteValue = override.metadata?.notes;
                  const noteText =
                    typeof noteValue === "string"
                      ? noteValue
                      : noteValue != null
                        ? String(noteValue)
                        : null;
                  return (
                    <li
                      key={override.id}
                      className="rounded-xl border border-white/10 bg-black/30 p-4"
                      data-testid="guardrail-override-item"
                    >
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                        <span>{override.scope.replace("_", " ")}</span>
                        <span>{new Date(override.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 font-medium text-white">{override.justification}</p>
                      {noteText && <p className="mt-1 text-xs text-white/60">Notes: {noteText}</p>}
                      <p className="mt-2 text-xs text-white/40">
                        Status: {override.isActive ? "Active" : "Superseded"}
                        {override.expiresAt ? ` · Expires ${new Date(override.expiresAt).toLocaleTimeString()}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-white">Apply override</h2>
            <p className="text-sm text-white/60">
              Overrides require justification and expire automatically to keep guardrails healthy.
            </p>
          </div>
          <GuardrailOverrideForm csrfToken={csrfToken} />
        </div>
      </section>
    </div>
  );
}
