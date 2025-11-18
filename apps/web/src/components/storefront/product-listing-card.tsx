import clsx from "clsx";
import Link from "next/link";

import type { PlatformContext, StorefrontProduct } from "@/data/storefront-experience";

type PlatformLookup = Record<string, PlatformContext>;

type StorefrontProductCardProps = {
  product: StorefrontProduct;
  platformLookup?: PlatformLookup;
  className?: string;
  footerHint?: string;
};

export function StorefrontProductCard({
  product,
  platformLookup = {},
  className,
  footerHint = "Saved billing, invoices, and intent signals flow straight into checkout with each purchase."
}: StorefrontProductCardProps) {
  const loyaltyPercent = Math.round(product.loyaltyHint.progress * 100);
  const accentClass = "rounded-[32px] border border-white/15 bg-gradient-to-b from-white/10 via-white/5 to-black/10";

  return (
    <article className={clsx(accentClass, "p-8 text-white shadow-lg shadow-black/25", className)}>
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2 text-left">
          <p className="text-sm uppercase tracking-[0.2em] text-white/60">{product.category}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-semibold">{product.name}</h3>
            {product.badge ? (
              <span className="rounded-full border border-white/40 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80">
                {product.badge}
              </span>
            ) : null}
          </div>
          <p className="text-white/70">{product.summary}</p>
          <div className="flex flex-wrap gap-2">
            {product.highlights.map((highlight) => (
              <span
                key={highlight.id}
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/70"
              >
                {highlight.label}
              </span>
            ))}
          </div>
        </div>
        <div className="text-left md:text-right">
          <p className="text-3xl font-semibold">{product.price}</p>
          <p className="text-sm text-white/60">{product.frequency}</p>
          <p className="text-sm font-semibold text-emerald-300">{product.trustSignal.value}</p>
          <p className="text-xs uppercase tracking-wide text-white/50">{product.trustSignal.label}</p>
        </div>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <p className="text-sm text-white/70">{product.journeyInsight}</p>
          <div className="flex flex-wrap gap-2">
            {product.eligibility.map((platformId) => {
              const platform = platformLookup[platformId];
              const accent = platform?.accent ?? "from-white/10 to-white/5";
              return (
                <span
                  key={`${product.id}-${platformId}`}
                  className={clsx("rounded-full bg-gradient-to-r px-4 py-1 text-sm font-semibold text-white/90", accent)}
                >
                  {platform?.name ?? platformId}
                </span>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Rewards</p>
          <p className="text-lg font-semibold">{product.loyaltyHint.value}</p>
          <p className="text-sm text-white/70">{product.loyaltyHint.reward}</p>
          <div className="mt-2 h-2 w-full rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-white via-emerald-200 to-emerald-400"
              style={{ width: `${loyaltyPercent}%` }}
              aria-label={`Loyalty progress ${loyaltyPercent}%`}
            />
          </div>
          <p className="mt-2 text-xs text-white/60">{product.sla}</p>
        </div>
      </div>

      <footer className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-white/70">{footerHint}</p>
        <Link
          className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          href={product.ctaHref}
        >
          {product.ctaLabel}
        </Link>
      </footer>
    </article>
  );
}
