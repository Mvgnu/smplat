import type { Metadata } from "next";

import { fetchReconciliationDashboard } from "@/server/billing/reconciliation";

import { ReconciliationDashboardView } from "./reconciliation-dashboard";

export const metadata: Metadata = {
  title: "Billing Reconciliation",
};

export default async function BillingReconciliationPage() {
  const dashboard = await fetchReconciliationDashboard();

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-16 text-white" data-testid="reconciliation-page">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Finance Operations</p>
        <h1 className="text-3xl font-semibold">Billing reconciliation</h1>
        <p className="text-white/70">
          Monitor reconciliation sweeps, triage staged processor events, and track discrepancies from a single
          dashboard.
        </p>
      </header>

      <ReconciliationDashboardView dashboard={dashboard} />
    </main>
  );
}
