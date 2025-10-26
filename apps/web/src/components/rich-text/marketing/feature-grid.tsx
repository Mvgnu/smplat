// meta: marketing-block: feature-grid

type FeatureItem = {
  title?: string;
  description?: string;
  icon?: string;
};

type FeatureGridProps = {
  heading?: string;
  subheading?: string;
  features: FeatureItem[];
  columns?: number;
};

const resolveColumns = (columns?: number) => {
  if (!columns || columns < 2) {
    return "sm:grid-cols-2";
  }

  if (columns >= 4) {
    return "md:grid-cols-4";
  }

  if (columns === 3) {
    return "md:grid-cols-3";
  }

  return "sm:grid-cols-2";
};

export function FeatureGrid({ heading, subheading, features, columns }: FeatureGridProps) {
  const validFeatures = features.filter((feature) => feature.title);

  if (validFeatures.length === 0) {
    return null;
  }

  const columnClass = resolveColumns(columns);

  return (
    <section className="space-y-6">
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="max-w-3xl text-white/70">{subheading}</p> : null}
      <div className={`grid gap-6 ${columnClass}`}>
        {validFeatures.map((feature, index) => (
          <div
            key={feature.title ?? index}
            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
          >
            {feature.icon ? (
              <span className="text-2xl" aria-hidden="true">
                {feature.icon}
              </span>
            ) : null}
            <p className="text-lg font-semibold text-white">{feature.title}</p>
            {feature.description ? <p className="text-sm text-white/70">{feature.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export type { FeatureItem };
