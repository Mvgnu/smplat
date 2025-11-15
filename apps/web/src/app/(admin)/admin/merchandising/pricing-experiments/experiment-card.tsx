import type { PricingExperiment, PricingExperimentMetric } from "@/types/pricing-experiments";
import {
  PricingExperimentEventForm,
  PricingExperimentStatusForm,
} from "./forms";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US");

type SparklineField = "exposures" | "conversions" | "revenueCents";

const buildSparklinePoints = (metrics: PricingExperimentMetric[], field: SparklineField, width: number, height: number): string => {
  if (!metrics.length) {
    return "";
  }
  const values = metrics.map((metric) => Number(metric[field] ?? 0));
  const maxValue = Math.max(...values, 1);
  const horizontalStep = metrics.length > 1 ? width / (metrics.length - 1) : 0;

  return metrics
    .map((metric, index) => {
      const value = Number(metric[field] ?? 0);
      const x = index * horizontalStep;
      const y = height - (maxValue === 0 ? 0 : (value / maxValue) * height);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
};

type VariantTableProps = {
  experiment: PricingExperiment;
};

const VariantTable = ({ experiment }: VariantTableProps) => {
  return (
    <div className="overflow-auto rounded-2xl border border-white/10">
      <table className="min-w-full divide-y divide-white/10 text-sm">
        <thead className="bg-white/5 text-white/60">
          <tr>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Variant</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Kind</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Weight</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Delta</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Multiplier</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Exposures</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Conversions</th>
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.3em]">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-white/80">
          {experiment.variants.map((variant) => {
            const totalExposures = variant.metrics.reduce((sum, metric) => sum + (metric.exposures ?? 0), 0);
            const totalConversions = variant.metrics.reduce((sum, metric) => sum + (metric.conversions ?? 0), 0);
            const totalRevenue = variant.metrics.reduce((sum, metric) => sum + (metric.revenueCents ?? 0), 0);
            return (
              <tr key={variant.key}>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-white">{variant.name}</span>
                    <span className="text-xs text-white/50">{variant.key}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-white/70">
                  {variant.adjustmentKind === "delta" ? "Delta" : "Multiplier"}
                  {variant.isControl ? (
                    <span className="ml-2 rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-white/60">
                      Control
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{numberFormatter.format(variant.weight)}</td>
                <td className="px-3 py-2">{numberFormatter.format(variant.priceDeltaCents)}¢</td>
                <td className="px-3 py-2">{variant.priceMultiplier ?? "—"}</td>
                <td className="px-3 py-2">{numberFormatter.format(totalExposures)}</td>
                <td className="px-3 py-2">{numberFormatter.format(totalConversions)}</td>
                <td className="px-3 py-2">{currencyFormatter.format(totalRevenue / 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const VariantTelemetry = ({ experiment }: { experiment: PricingExperiment }) => {
  const width = 220;
  const height = 64;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {experiment.variants.map((variant) => {
        const exposuresPoints = buildSparklinePoints(variant.metrics, "exposures", width, height);
        const conversionsPoints = buildSparklinePoints(variant.metrics, "conversions", width, height);
        const revenuePoints = buildSparklinePoints(variant.metrics, "revenueCents", width, height);

        return (
          <div key={`telemetry-${variant.key}`} className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{variant.name}</p>
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Telemetry</p>
              </div>
              {variant.isControl ? (
                <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-white/60">
                  Control
                </span>
              ) : null}
            </div>
            {variant.metrics.length === 0 ? (
              <p className="text-xs text-white/60">No metrics logged yet.</p>
            ) : (
              <div className="space-y-2 text-xs text-white/70">
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.3em] text-white/40">Exposures</p>
                  <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full">
                    <polyline
                      fill="none"
                      stroke="rgba(255,255,255,0.6)"
                      strokeWidth="2"
                      points={exposuresPoints}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.3em] text-white/40">Conversions</p>
                  <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full">
                    <polyline
                      fill="none"
                      stroke="rgba(16,185,129,0.8)"
                      strokeWidth="2"
                      points={conversionsPoints}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.3em] text-white/40">Revenue</p>
                  <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full">
                    <polyline
                      fill="none"
                      stroke="rgba(250,204,21,0.8)"
                      strokeWidth="2"
                      points={revenuePoints}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export function PricingExperimentCard({ experiment }: { experiment: PricingExperiment }) {
  return (
    <section className="space-y-5 rounded-3xl border border-white/15 bg-gradient-to-br from-black/70 to-black/40 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Experiment</p>
          <h3 className="text-2xl font-semibold text-white">{experiment.name}</h3>
          <p className="text-sm text-white/70">{experiment.description || "No description provided."}</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <span className="rounded-full border border-white/30 px-4 py-1 text-xs uppercase tracking-[0.3em] text-white">
            {experiment.status}
          </span>
          <div className="text-xs text-white/60">
            <p>Target product: {experiment.targetProductSlug}</p>
            {experiment.targetSegment ? <p>Segment: {experiment.targetSegment}</p> : null}
            {experiment.featureFlagKey ? <p>Flag: {experiment.featureFlagKey}</p> : null}
          </div>
        </div>
      </header>
      <VariantTable experiment={experiment} />
      <VariantTelemetry experiment={experiment} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PricingExperimentStatusForm experiment={experiment} />
        <PricingExperimentEventForm experiment={experiment} />
      </div>
    </section>
  );
}
