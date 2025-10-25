import Link from "next/link";

export type ProductFeature = {
  id?: string;
  label?: string;
};

type ProductCardProps = {
  badge?: string;
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  frequency?: string;
  features?: ProductFeature[];
  ctaLabel?: string;
  ctaHref?: string;
};

const formatPrice = (price?: number, currency = "USD", frequency?: string) => {
  if (typeof price !== "number") {
    return null;
  }

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(price);

  return frequency ? `${formatted}/${frequency}` : formatted;
};

export function ProductCard({
  badge,
  name,
  description,
  price,
  currency,
  frequency,
  features = [],
  ctaLabel,
  ctaHref
}: ProductCardProps) {
  if (!name && !description) {
    return null;
  }

  const priceDisplay = formatPrice(price, currency, frequency);
  const featureItems = features.filter((feature) => feature.label);

  return (
    <article className="flex h-full flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 text-left backdrop-blur">
      {badge ? (
        <span className="self-start rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70">
          {badge}
        </span>
      ) : null}
      {name ? <h3 className="text-2xl font-semibold text-white">{name}</h3> : null}
      {description ? <p className="text-sm text-white/70">{description}</p> : null}
      {priceDisplay ? <p className="text-3xl font-semibold text-white">{priceDisplay}</p> : null}
      {featureItems.length > 0 ? (
        <ul className="space-y-2 text-sm text-white/70">
          {featureItems.map((feature, index) => (
            <li key={feature.id ?? feature.label ?? index} className="flex items-start gap-2">
              <span aria-hidden className="mt-1 inline-block h-2 w-2 rounded-full bg-white/60" />
              <span>{feature.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ctaHref ? (
        <div>
          <Link
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/80"
            href={ctaHref}
          >
            {ctaLabel ?? "View details"}
          </Link>
        </div>
      ) : null}
    </article>
  );
}
