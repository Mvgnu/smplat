import type { QuickOrderTelemetryContext } from "@/types/quick-order";
import type { ReceiptStorageComponent } from "@/server/health/readiness";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import { QuickOrderModalLauncher } from "@/components/account/QuickOrderModalLauncher";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";
import { formatRelativeTimestamp } from "@/lib/delivery-proof-insights";

type QuickOrderTelemetryCardProps = {
  context: QuickOrderTelemetryContext | null;
  receiptStatus: ReceiptStorageComponent | null;
  workflowTelemetry: GuardrailWorkflowTelemetrySummary | null;
};

const receiptStatusTone: Record<string, string> = {
  ready: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  degraded: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  error: "border-rose-400/40 bg-rose-500/10 text-rose-100",
  starting: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  disabled: "border-white/20 bg-white/5 text-white/70",
};

export function QuickOrderTelemetryCard({ context, receiptStatus, workflowTelemetry }: QuickOrderTelemetryCardProps) {
  if (!context && !receiptStatus) {
    return null;
  }

  const receiptTone = receiptStatus ? receiptStatusTone[receiptStatus.status] ?? receiptStatusTone.degraded : null;
  const receiptDetail = receiptStatus?.detail ?? "Receipt storage probe status unavailable.";
  const receiptLastSuccess = formatRelativeTimestamp(receiptStatus?.lastSuccessAt ?? null);
  const workflowTelemetryPanel = (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
      <QuickOrderWorkflowTelemetry initialTelemetry={workflowTelemetry} testId="workflow-telemetry-account-card" />
    </div>
  );

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Quick-order trust snapshot</p>
          <h2 className="text-xl font-semibold text-white">Platform telemetry preview</h2>
          <p className="text-sm text-white/60">
            Before launching a quick order, confirm the latest delivery proof, automation telemetry, and receipt archival
            status.
          </p>
        </div>
        <QuickOrderModalLauncher context={context} receiptStatus={receiptStatus} />
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Blueprint confidence</p>
          {context ? (
            <>
              <div>
                <p className="text-sm font-semibold text-white">{context.productTitle}</p>
                <p className="text-xs text-white/60">{context.platformLabel}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Baseline</p>
                  <p className="text-2xl font-semibold text-white">{context.followerBaseline}</p>
                  {context.lastSnapshotRelative ? (
                    <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                      Snapshot {context.lastSnapshotRelative}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Delta</p>
                  <p className="text-2xl font-semibold text-white">{context.followerDelta}</p>
                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Follower lift</p>
                </div>
              </div>
              {context.providerTelemetry ? (
                <ul className="grid gap-2 sm:grid-cols-2 text-xs text-white/70">
                  <li className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Orders routed</p>
                    <p className="text-lg font-semibold text-white">{context.providerTelemetry.totalOrders}</p>
                  </li>
                  <li className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Guardrail status</p>
                    <p className="text-lg font-semibold text-white">
                      {context.providerTelemetry.guardrails.fail}/{context.providerTelemetry.guardrails.evaluated} fail/evaluated
                    </p>
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-white/60">
                  Provider automation telemetry will populate here after your first routed order finishes.
                </p>
              )}
              {workflowTelemetryPanel}
            </>
          ) : (
            <>
              <p className="text-sm text-white/60">
                Once delivery proof lands, we’ll surface platform metrics here so quick-order suggestions reflect real results.
              </p>
              {workflowTelemetryPanel}
            </>
          )}
        </article>
        <article className={`space-y-2 rounded-2xl border p-4 ${receiptTone ?? "border-white/20 bg-white/5 text-white/80"}`}>
          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/50">Receipt storage probe</p>
          {receiptStatus ? (
            <>
              <p className="text-xl font-semibold">{receiptStatus.status.replace("_", " ")}</p>
              <p className="text-sm">{receiptDetail}</p>
              <p className="text-xs text-white/60">Last success {receiptLastSuccess}</p>
            </>
          ) : (
            <p className="text-sm text-white/60">
              Receipt archival status will appear here once the readiness probe captures the latest snapshot.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
