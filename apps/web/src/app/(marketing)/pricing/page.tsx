import { notFound } from "next/navigation";

import { MarketingSections, defaultMarketingMetricsFallback } from "@/components/marketing/sections";
import { getPageBySlug } from "@/server/cms/loaders";

const PRICING_SLUG = "pricing";
const SECTION_CONTENT_CLASSNAME =
  "mx-auto max-w-3xl space-y-4 text-left [&_*]:text-white/80 [&_strong]:text-white [&_a]:underline";

const resolveHero = (page: Awaited<ReturnType<typeof getPageBySlug>>) => {
  if (page?.hero) {
    return page.hero;
  }

  return {
    headline: page?.title
  };
};

export default async function PricingPage() {
  const page = await getPageBySlug(PRICING_SLUG);

  if (!page) {
    notFound();
  }

  const hero = resolveHero(page);

  return (
    <main className="mx-auto max-w-5xl px-6 py-24 text-white">
      <article className="space-y-12">
        <header className="text-center">
          {hero.eyebrow ? (
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">{hero.eyebrow}</p>
          ) : null}
          <h1 className="text-4xl font-semibold md:text-5xl">{hero.headline ?? page.title}</h1>
          {hero.subheadline ? <p className="mt-4 text-lg text-white/70">{hero.subheadline}</p> : null}
        </header>

        <MarketingSections
          sections={page.content}
          sectionContentClassName={SECTION_CONTENT_CLASSNAME}
          metricFallback={defaultMarketingMetricsFallback}
        />
      </article>
    </main>
  );
}
