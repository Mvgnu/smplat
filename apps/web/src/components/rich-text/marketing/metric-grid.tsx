export type MetricItem = {
  label?: string;
  value?: string;
  description?: string;
};

type MetricGridProps = {
  heading?: string;
  subheading?: string;
  metrics: MetricItem[];
};

export function MetricGrid({ heading, subheading, metrics }: MetricGridProps) {
  const validMetrics = metrics.filter((metric) => metric.value && metric.label);

  if (validMetrics.length === 0) {
    return null;
  }

  return (
    <section className="space-y-6 text-center">
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="mx-auto max-w-3xl text-white/70">{subheading}</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        {validMetrics.map((metric, index) => (
          <div
            key={metric.label ?? index}
            className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center backdrop-blur"
          >
            <p className="text-3xl font-semibold text-white">{metric.value}</p>
            <p className="mt-2 text-sm uppercase tracking-wide text-white/60">{metric.label}</p>
            {metric.description ? <p className="mt-3 text-sm text-white/50">{metric.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
