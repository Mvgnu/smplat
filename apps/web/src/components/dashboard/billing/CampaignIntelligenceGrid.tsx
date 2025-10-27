// meta: component: CampaignIntelligenceGrid
// meta: feature: dashboard-billing

import type { CampaignInsight } from "@/server/billing/types";

type CampaignIntelligenceGridProps = {
  insights: CampaignInsight[];
  currencyFormatter: Intl.NumberFormat;
};

export function CampaignIntelligenceGrid({ insights, currencyFormatter }: CampaignIntelligenceGridProps) {
  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-white/60">
        Campaign intelligence will appear once invoices include fulfillment and Instagram telemetry
        metadata.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-white">Campaign intelligence</h3>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight) => (
          <div
            key={`${insight.invoiceId}-${insight.campaign}`}
            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-5 text-sm text-white/70"
          >
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Campaign</p>
                <p className="text-base font-semibold text-white">{insight.campaign}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Spend</p>
                <p className="text-base font-semibold text-white">
                  {currencyFormatter.format(insight.spend)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-white/60">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="uppercase tracking-[0.25em]">Reach delta</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {formatDelta(insight.reachDelta)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="uppercase tracking-[0.25em]">Fulfillment</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {Math.round(insight.fulfillmentSuccessRate * 100)}%
                </p>
              </div>
            </div>
            <p className="text-xs text-white/60">{insight.commentary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(value))}%`;
}
