import Link from "next/link";

export type PricingTier = {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  features?: string[];
  ctaLabel?: string;
  ctaHref?: string;
  highlight?: boolean;
};

type PricingGridProps = {
  tiers: PricingTier[];
};

export function PricingGrid({ tiers }: PricingGridProps) {
  if (!tiers.length) {
    return null;
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {tiers.map((tier, index) => (
        <article
          key={tier.name ?? index}
          className={`rounded-3xl border px-6 py-8 text-left backdrop-blur transition ${tier.highlight ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"}`}
        >
          <p className={`text-sm uppercase tracking-wide ${tier.highlight ? "text-black/70" : "text-white/60"}`}>{tier.name}</p>
          <p className="mt-2 text-3xl font-semibold">
            {tier.currency ?? "EUR"} {tier.price?.toLocaleString(undefined, { minimumFractionDigits: 0 })}
          </p>
          {tier.description ? (
            <p className={`mt-3 text-sm ${tier.highlight ? "text-black/70" : "text-white/70"}`}>{tier.description}</p>
          ) : null}
          {tier.features?.length ? (
            <ul className={`mt-6 space-y-2 text-sm ${tier.highlight ? "text-black/70" : "text-white/70"}`}>
              {tier.features.map((feature, featIndex) => (
                <li key={`${tier.name}-feature-${featIndex}`}>• {feature}</li>
              ))}
            </ul>
          ) : null}
          {tier.ctaHref ? (
            <Link
              className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition ${tier.highlight ? "bg-black text-white hover:bg-black/80" : "bg-white text-black hover:bg-white/80"}`}
              href={tier.ctaHref}
            >
              {tier.ctaLabel ?? "Choose plan"}
            </Link>
          ) : null}
        </article>
      ))}
    </div>
  );
}
