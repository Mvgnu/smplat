import Link from "next/link";

import { PostList } from "@/components/blog/post-list";
import { FaqAccordion } from "@/components/faq/accordion";
import { CaseStudyHighlight } from "@/components/case-studies/highlight";
import { PricingGrid } from "@/components/pricing/pricing-grid";
import { TestimonialHighlights } from "@/components/testimonials/highlights";
import { RichText } from "@/components/rich-text/rich-text";
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

const fallbackMetrics = [
  { label: "Campaigns launched", value: "1,200+", description: "Successful campaigns delivered" },
  { label: "Average ROI uplift", value: "3.4x", description: "Typical return on investment" },
  { label: "Client retention", value: "92%", description: "Long-term partnership rate" }
];

type PageSection = NonNullable<PageDocument["content"]>[number];

export default async function HomePage() {
  const page = await getHomepage();
  const hero = page?.hero ?? fallbackHero;
  const sections = page?.content ?? [];
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

      {sections.length > 0 ? (
        <section id="capabilities" className="mx-auto flex w-full max-w-5xl flex-col gap-16">
          {sections.map((section: PageSection) => {
            if (section._type === "testimonial") {
              return (
                <blockquote
                  key={section.quote}
                  className="rounded-3xl border border-white/10 bg-white/5 p-10 text-left shadow-lg backdrop-blur"
                >
                  <p className="text-xl italic text-white/80">“{section.quote}”</p>
                  <footer className="mt-6 text-sm text-white/60">
                    {section.author ? <span className="font-semibold text-white">{section.author}</span> : null}
                    {section.role ? <span> · {section.role}</span> : null}
                    {section.company ? <span> @ {section.company}</span> : null}
                  </footer>
                </blockquote>
              );
            }

            const key = section._key ?? section.heading ?? section.layout ?? "section";
            const layout = section.layout ?? "two-column";

            if (layout === "metrics") {
              const metrics = section.metrics && section.metrics.length > 0 ? section.metrics : fallbackMetrics;
              return (
                <div key={key} className="space-y-6 text-center">
                  {section.heading ? <h2 className="text-3xl font-semibold">{section.heading}</h2> : null}
                  {section.subheading ? (
                    <p className="mx-auto max-w-3xl text-white/70">{section.subheading}</p>
                  ) : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <div className="grid gap-4 sm:grid-cols-3">
                    {metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center backdrop-blur"
                      >
                        <p className="text-3xl font-semibold">{metric.value}</p>
                        <p className="mt-2 text-sm uppercase tracking-wide text-white/60">{metric.label}</p>
                        {metric.description ? (
                          <p className="mt-3 text-sm text-white/50">{metric.description}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (layout === "faq" && section.faqItems?.length) {
              const faqItems = section.faqItems.map((faq) => ({
                question: faq.question ?? "",
                answer: faq.answer ?? ""
              }));
              return (
                <div key={key} className="space-y-6">
                  {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <FaqAccordion items={faqItems} />
                </div>
              );
            }

            if (layout === "testimonials" && section.testimonials?.length) {
              return (
                <div key={key} className="space-y-6">
                  {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <TestimonialHighlights items={section.testimonials} />
                </div>
              );
            }

            if (layout === "case-study" && section.caseStudy) {
              return (
                <div key={key} className="space-y-6">
                  {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <CaseStudyHighlight caseStudy={section.caseStudy} />
                </div>
              );
            }

            if (layout === "pricing" && section.pricingTiers?.length) {
              return (
                <div key={key} className="space-y-8">
                  {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <PricingGrid tiers={section.pricingTiers} />
                </div>
              );
            }

            if (layout === "blog" && section.blogPosts?.length) {
              return (
                <div key={key} className="space-y-6">
                  {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
                  {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
                  <PostList posts={section.blogPosts} />
                </div>
              );
            }

            return (
              <div key={key} className="space-y-4 text-center">
                {section.heading ? <h2 className="text-3xl font-semibold">{section.heading}</h2> : null}
                {section.subheading ? (
                  <p className="mx-auto max-w-3xl text-white/70">{section.subheading}</p>
                ) : null}
                {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClass} /> : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}
