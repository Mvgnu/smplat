import type { TrustMetric } from "@/data/storefront-experience";

type TrustMetricRibbonProps = {
  metrics: TrustMetric[];
};

const trendColorMap: Record<TrustMetric["trendDirection"], string> = {
  up: "text-emerald-300",
  flat: "text-white/70",
  down: "text-rose-300"
};

export function TrustMetricRibbon({ metrics }: TrustMetricRibbonProps) {
  if (!metrics.length) {
    return null;
  }

  return (
    <section
      aria-label="Storefront trust metrics"
      className="mx-auto w-full max-w-6xl rounded-3xl border border-white/10 bg-white/5 px-6 py-8 text-white"
    >
      <dl className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="space-y-1">
            <dt className="text-sm uppercase tracking-wide text-white/60">{metric.label}</dt>
            <dd className="text-3xl font-semibold">{metric.value}</dd>
            <p className="text-sm text-white/70">{metric.description}</p>
            <p className={`text-xs font-medium ${trendColorMap[metric.trendDirection]}`}>
              {metric.trendLabel} · {metric.trendValue}
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}

