import Link from "next/link";

import type { StorefrontHeroContent } from "@/data/storefront-experience";

type StorefrontHeroProps = {
  hero: StorefrontHeroContent;
};

export function StorefrontHero({ hero }: StorefrontHeroProps) {
  return (
    <section
      aria-labelledby="storefront-hero"
      className="mx-auto w-full max-w-6xl rounded-[40px] border border-white/10 bg-gradient-to-b from-slate-900/80 via-slate-900/60 to-black px-8 py-16 shadow-2xl shadow-purple-500/10 sm:px-12"
    >
      <div className="space-y-6 text-left text-white">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">{hero.eyebrow}</p>
        <h1 id="storefront-hero" className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
          {hero.headline}
        </h1>
        <p className="text-lg text-white/70">{hero.subheadline}</p>
        <div className="flex flex-wrap gap-4">
          <Link
            className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            href={hero.primaryCta.href}
          >
            {hero.primaryCta.label}
          </Link>
          {hero.secondaryCta ? (
            <Link
              className="inline-flex items-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
              href={hero.secondaryCta.href}
            >
              {hero.secondaryCta.label}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {hero.highlights.map((highlight) => (
          <div
            key={highlight.id}
            className="rounded-3xl border border-white/10 bg-white/5 px-6 py-6 text-white shadow-inner shadow-black/20"
          >
            <p className="text-sm font-semibold uppercase tracking-wide text-white/60">{highlight.label}</p>
            <p className="mt-2 text-3xl font-semibold">{highlight.value}</p>
            <p className="mt-1 text-sm text-white/70">{highlight.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

