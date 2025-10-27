import type { Metadata } from "next";

import { fetchProcessorReplays } from "@/server/billing/replays";

import { ReplayDashboardView } from "./replay-dashboard";

export const metadata: Metadata = {
  title: "Billing Replays",
};

export default async function BillingReplaysPage() {
  const events = await fetchProcessorReplays({ requestedOnly: false, limit: 200 });

  return (
    <main
      className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-16 text-white"
      data-testid="replay-console-page"
    >
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Finance Operations</p>
        <h1 className="text-3xl font-semibold">Processor replay console</h1>
        <p className="text-white/70">
          Search processor events, inspect replay history, and trigger replays directly from the operator
          console.
        </p>
      </header>

      <ReplayDashboardView initialEvents={events} />
    </main>
  );
}
