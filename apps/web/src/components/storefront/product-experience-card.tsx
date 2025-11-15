import clsx from "clsx";

import type { StorefrontProduct } from "@/data/storefront-experience";
import type { CartProductExperience } from "@/types/cart";

type ProductExperienceSource = Pick<
  StorefrontProduct,
  "category" | "name" | "journeyInsight" | "trustSignal" | "loyaltyHint" | "highlights" | "sla"
>;

type ProductExperienceCardProps = {
  product?: ProductExperienceSource | CartProductExperience;
  variant?: "default" | "compact";
  className?: string;
};

export function ProductExperienceCard({ product, variant = "default", className }: ProductExperienceCardProps) {
  if (!product) {
    return null;
  }

  const loyaltyPercent = Math.round(product.loyaltyHint.progress * 100);
  const highlightLimit = variant === "compact" ? Math.min(product.highlights.length, 2) : product.highlights.length;
  const containerClass = clsx(
    "rounded-3xl border border-white/10 bg-white/5 text-white backdrop-blur",
    variant === "compact" ? "p-4" : "p-6",
    className
  );

  return (
    <section aria-label="Product trust and loyalty summary" className={containerClass}>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">{product.category}</p>
        <h2 className="text-2xl font-semibold">{product.name}</h2>
        <p className="text-sm text-white/70">{product.journeyInsight}</p>
      </div>

      <div className={clsx("mt-6 grid gap-4", variant === "compact" ? "md:grid-cols-1" : "md:grid-cols-2")}>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">Trust signal</p>
          <p className="mt-2 text-3xl font-semibold text-white">{product.trustSignal.value}</p>
          <p className="text-sm text-white/70">{product.trustSignal.label}</p>
          <p className="mt-3 text-xs text-white/60">{product.sla}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">Loyalty progress</p>
          <p className="mt-2 text-2xl font-semibold text-white">{product.loyaltyHint.value}</p>
          <p className="text-sm text-white/70">{product.loyaltyHint.reward}</p>
          <div className="mt-3 h-2 rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-emerald-200 via-white to-yellow-300"
              style={{ width: `${loyaltyPercent}%` }}
              data-testid="product-loyalty-progress"
            />
          </div>
        </div>
      </div>

      {highlightLimit > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2" data-testid="experience-highlights">
          {product.highlights.slice(0, highlightLimit).map((highlight) => (
            <span
              key={highlight.id}
              className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
            >
              {highlight.label}
            </span>
          ))}
          {variant === "compact" && product.highlights.length > highlightLimit ? (
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
              +{product.highlights.length - highlightLimit} more
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
