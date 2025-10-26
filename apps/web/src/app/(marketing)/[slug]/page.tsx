import { notFound } from "next/navigation";

import { getPageBySlug } from "@/server/cms/loaders";
import { MarketingSections, defaultMarketingMetricsFallback } from "@/components/marketing/sections";

type MarketingPageProps = {
  params: { slug: string };
};

export default async function MarketingPage({ params }: MarketingPageProps) {
  const { slug } = params;
  const page = await getPageBySlug(slug);

  if (!page) {
    notFound();
  }

  const hero = page.hero ?? { headline: page.title };
  const sections = page.content;
  const sectionContentClass =
    "mx-auto max-w-3xl space-y-4 text-left [&_*]:text-white/80 [&_strong]:text-white [&_a]:underline";

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

        {sections?.length ? (
          <MarketingSections
            sections={sections}
            sectionContentClassName={sectionContentClass}
            metricFallback={defaultMarketingMetricsFallback}
          />
        ) : null}
      </article>
    </main>
  );
}
