import { MarketingSections, defaultMarketingMetricsFallback } from "@/components/marketing/sections";
import { ProductShowcase } from "@/components/storefront/product-showcase";
import { RewardCallouts } from "@/components/storefront/reward-callouts";
import { StorefrontHero } from "@/components/storefront/hero";
import { TestimonialTicker } from "@/components/storefront/testimonial-ticker";
import { TrustMetricRibbon } from "@/components/storefront/trust-metric-ribbon";
import { getStorefrontExperience } from "@/server/storefront/experience";
import { getHomepage } from "@/server/cms/loaders";
import type { PageDocument } from "@/server/cms/types";

export default async function HomePage() {
  const page = await getHomepage();
  const sections = page?.content;
  const sectionContentClass =
    "mx-auto max-w-3xl space-y-4 text-left [&_*]:text-white/80 [&_strong]:text-white [&_a]:underline";
  const experience = await getStorefrontExperience(page);

  return (
    <main className="flex min-h-screen flex-col gap-16 bg-gradient-to-b from-slate-950 via-slate-900 to-black px-6 py-16 text-white md:gap-20 md:py-24">
      <StorefrontHero hero={experience.hero} />
      <TrustMetricRibbon metrics={experience.trustMetrics} />
      <ProductShowcase platforms={experience.platforms} products={experience.products} />
      <RewardCallouts rewards={experience.rewards} />
      <TestimonialTicker testimonials={experience.testimonials} />
      {sections?.length ? (
        <MarketingSections
          id="capabilities"
          sections={sections}
          sectionContentClassName={sectionContentClass}
          metricFallback={defaultMarketingMetricsFallback}
        />
      ) : null}
    </main>
  );
}
