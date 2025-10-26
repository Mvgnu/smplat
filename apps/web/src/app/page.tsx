import Link from "next/link";

import { MarketingSections, defaultMarketingMetricsFallback } from "@/components/marketing/sections";
import { getHomepage } from "@/server/cms/loaders";
import type { PageDocument } from "@/server/cms/types";


const fallbackHero = {
  eyebrow: "Social Media Growth, Engineered for Agencies",
  headline: "Launch a premium storefront for your social media services in weeks, not months.",
  subheadline:
    "SMPLAT streamlines service purchases, automates fulfillment, and keeps bookkeeping compliant—so you can focus on scaling clients.",
  cta: {
    label: "Book Discovery Call",
    href: "#contact"
  }
};

const fallbackMetrics = defaultMarketingMetricsFallback;

export default async function HomePage() {
  const page = await getHomepage();
  const hero = page?.hero ?? fallbackHero;
  const sections = page?.content;
  const sectionContentClass =
    "mx-auto max-w-3xl space-y-4 text-left [&_*]:text-white/80 [&_strong]:text-white [&_a]:underline";

  return (
    <main className="flex min-h-screen flex-col gap-24 bg-gradient-to-b from-slate-950 via-slate-900 to-black px-6 py-24 text-white">
      <section className="mx-auto max-w-4xl text-center">
        {hero.eyebrow ? (
          <span className="mb-4 inline-flex items-center rounded-full border border-white/20 px-4 py-1 text-sm text-white/70">
            {hero.eyebrow}
          </span>
        ) : null}
        <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">{hero.headline}</h1>
        {hero.subheadline ? (
          <p className="mt-6 text-lg text-white/70">{hero.subheadline}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          {hero.cta?.href ? (
            <Link
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/80"
              href={hero.cta.href}
            >
              {hero.cta.label ?? "Get Started"}
            </Link>
          ) : null}
          <Link
            className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
            href="#capabilities"
          >
            Explore Capabilities
          </Link>
        </div>
      </section>

      {sections?.length ? (
        <MarketingSections
          id="capabilities"
          sections={sections}
          sectionContentClassName={sectionContentClass}
          metricFallback={fallbackMetrics}
        />
      ) : null}
    </main>
  );
}
