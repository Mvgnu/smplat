'use client';

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import type { PlatformContext, StorefrontProduct } from "@/data/storefront-experience";
import { usePlatformSelection, useStorefrontStateActions } from "@/context/storefront-state";
import { usePlatformRouteUpdater } from "@/hooks/usePlatformRouting";

import { StorefrontProductCard } from "./product-listing-card";

const ALL_PLATFORMS = "all-platforms";

type ProductShowcaseProps = {
  products: StorefrontProduct[];
  platforms: PlatformContext[];
};

export function ProductShowcase({ products, platforms }: ProductShowcaseProps) {
  const platformSelection = usePlatformSelection();
  const { setPlatform } = useStorefrontStateActions();
  const updateRoute = usePlatformRouteUpdater();
  const [activePlatform, setActivePlatform] = useState<string>(platformSelection?.id ?? ALL_PLATFORMS);

  useEffect(() => {
    setActivePlatform(platformSelection?.id ?? ALL_PLATFORMS);
  }, [platformSelection?.id]);
  const platformLookup = useMemo(
    () =>
      platforms.reduce<Record<string, PlatformContext>>((acc, platform) => {
        acc[platform.id] = platform;
        return acc;
      }, {}),
    [platforms]
  );

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

  const handlePlatformChange = (platformId: string) => {
    setActivePlatform(platformId);
    if (platformId === ALL_PLATFORMS) {
      setPlatform(null);
      updateRoute(null);
      return;
    }
    const selectedPlatform = platformLookup[platformId];
    if (!selectedPlatform) {
      return;
    }
    setPlatform({
      id: selectedPlatform.id,
      label: selectedPlatform.name,
      platformType: selectedPlatform.tagline
    });
    updateRoute(selectedPlatform.id);
  };

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
              onClick={() => handlePlatformChange(platform.id)}
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
          <StorefrontProductCard
            key={product.id}
            product={product}
            platformLookup={platformLookup}
            footerHint="Loyal customers start from account dashboards, so saved billing, invoices, and reward intents persist into checkout."
          />
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
