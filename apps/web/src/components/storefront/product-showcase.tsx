'use client';

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";

import type { PlatformContext, StorefrontProduct } from "@/data/storefront-experience";

const ALL_PLATFORMS = "all-platforms";

type ProductShowcaseProps = {
  products: StorefrontProduct[];
  platforms: PlatformContext[];
};

export function ProductShowcase({ products, platforms }: ProductShowcaseProps) {
  const [activePlatform, setActivePlatform] = useState<string>(ALL_PLATFORMS);

  const visibleProducts = useMemo(() => {
    if (activePlatform === ALL_PLATFORMS) {
      return products;
    }
    return products.filter((product) => product.eligibility.includes(activePlatform));
  }, [activePlatform, products]);

  const platformFilters = [
    {
      id: ALL_PLATFORMS,
      name: "All channels",
      tagline: "Full catalog",
      description: "Platform-aware defaults"
    },
    ...platforms
  ];

  return (
    <section id="products" className="mx-auto flex w-full max-w-6xl flex-col gap-10 text-white">
      <header className="space-y-3 text-left">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">Product listing</p>
        <h2 className="text-3xl font-semibold">Shop by channel and intent</h2>
        <p className="text-white/70">
          Save a platform profile, launch a configurator from the account dashboard, and keep loyalty nudges in view the
          entire time.
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {platformFilters.map((platform) => {
          const isActive = activePlatform === platform.id;
          return (
            <button
              key={platform.id}
              type="button"
              onClick={() => setActivePlatform(platform.id)}
              className={clsx(
                "rounded-2xl border px-4 py-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                isActive ? "border-white bg-white/10" : "border-white/10 bg-white/5 hover:border-white/30"
              )}
              aria-pressed={isActive}
            >
              <p className="text-sm font-semibold uppercase tracking-wide text-white/60">{platform.tagline}</p>
              <p className="text-lg font-semibold">{platform.name}</p>
              <p className="text-sm text-white/70">{platform.description}</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6">
        {visibleProducts.map((product) => (
          <article
            key={product.id}
            className="rounded-[32px] border border-white/15 bg-gradient-to-b from-white/10 via-white/5 to-black/10 p-8 shadow-lg shadow-black/25"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2 text-left">
                <p className="text-sm uppercase tracking-[0.2em] text-white/60">{product.category}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-semibold text-white">{product.name}</h3>
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
                <p className="text-3xl font-semibold text-white">{product.price}</p>
                <p className="text-sm text-white/60">{product.frequency}</p>
                <p className="text-sm font-semibold text-emerald-300">{product.trustSignal.value}</p>
                <p className="text-xs uppercase tracking-wide text-white/50">{product.trustSignal.label}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[2fr_1fr]">
              <div className="space-y-3">
                <p className="text-sm text-white/70">{product.journeyInsight}</p>
                <div className="flex flex-wrap gap-2">
                  {product.eligibility.map((platformId) => {
                    const platform = platforms.find((p) => p.id === platformId);
                    return (
                      <span
                        key={`${product.id}-${platformId}`}
                        className={clsx(
                          "rounded-full bg-gradient-to-r px-4 py-1 text-sm font-semibold text-white/90",
                          platform?.accent ?? "from-white/10 to-white/5"
                        )}
                      >
                        {platform?.name ?? platformId}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left text-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Rewards</p>
                <p className="text-lg font-semibold">{product.loyaltyHint.value}</p>
                <p className="text-sm text-white/70">{product.loyaltyHint.reward}</p>
                <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-white via-emerald-200 to-emerald-400"
                    style={{ width: `${Math.round(product.loyaltyHint.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-white/60">{product.sla}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-white/70">
                Loyal customers start from account dashboards, so saved billing, invoices, and reward intents persist
                into checkout.
              </p>
              <Link
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
                href={product.ctaHref}
              >
                {product.ctaLabel}
              </Link>
            </div>
          </article>
        ))}

        {!visibleProducts.length ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center text-white/70">
            No products match this platform yet—stay tuned as we expand coverage.
          </p>
        ) : null}
      </div>
    </section>
  );
}
