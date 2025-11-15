// meta: marketing-renderer:lexical-unification

import { PostList } from "@/components/blog/post-list";
import { CaseStudyHighlight } from "@/components/case-studies/highlight";
import { FaqAccordion } from "@/components/faq/accordion";
import { PricingGrid } from "@/components/pricing/pricing-grid";
import { CtaCluster } from "@/components/rich-text/marketing/cta-cluster";
import { FeatureGrid } from "@/components/rich-text/marketing/feature-grid";
import { HeroCallout } from "@/components/rich-text/marketing/hero-callout";
import { MediaGallery } from "@/components/rich-text/marketing/media-gallery";
import { MetricGrid } from "@/components/rich-text/marketing/metric-grid";
import { ProductCard } from "@/components/rich-text/marketing/product-card";
import { TestimonialCallout } from "@/components/rich-text/marketing/testimonial-callout";
import { ComparisonTable } from "@/components/rich-text/marketing/comparison-table";
import { TimelineShowcase } from "@/components/rich-text/marketing/timeline";
import { RichText } from "@/components/rich-text/rich-text";
import { TestimonialHighlights } from "@/components/testimonials/highlights";
import { parseMarketingSectionContent } from "@/marketing/content";
import type { MarketingContentDocument, PageDocument } from "@/server/cms/types";

export type PageSection = NonNullable<PageDocument["content"]>[number];
type SectionBlock = Extract<PageSection, { _type: "section" }>;
export type MetricItem = NonNullable<SectionBlock["metrics"]>[number];

const DEFAULT_METRIC_FALLBACK: MetricItem[] = [
  { label: "Campaigns launched", value: "1,200+", description: "Successful campaigns delivered" },
  { label: "Average ROI uplift", value: "3.4x", description: "Typical return on investment" },
  { label: "Client retention", value: "92%", description: "Long-term partnership rate" }
];

type MarketingSectionsProps = {
  sections?: PageDocument["content"];
  sectionContentClassName: string;
  metricFallback?: MetricItem[];
  id?: string;
};

type TestimonialBlock = Extract<PageSection, { _type: "testimonial" }>;

const resolveMarketingContent = (section: SectionBlock): MarketingContentDocument[] => {
  if (section.marketingContent?.length) {
    return section.marketingContent;
  }

  const parsed = parseMarketingSectionContent(section.content);
  return parsed.length > 0 ? (parsed as MarketingContentDocument[]) : [];
};

const resolveMetricsFallback = (section: SectionBlock, metricFallback: MetricItem[]) => {
  if (section.metrics?.length) {
    return section.metrics;
  }
  return metricFallback;
};

type MarketingContent = MarketingContentDocument;

type MetricsContent = Extract<MarketingContent, { kind: "metrics" }>;

type ProductContent = Extract<MarketingContent, { kind: "product" }>;

type HeroContent = Extract<MarketingContent, { kind: "hero" }>;

type TestimonialContent = Extract<MarketingContent, { kind: "testimonial" }>;

type TimelineContent = Extract<MarketingContent, { kind: "timeline" }>;

type FeatureGridContent = Extract<MarketingContent, { kind: "feature-grid" }>;

type MediaGalleryContent = Extract<MarketingContent, { kind: "media-gallery" }>;

type CtaClusterContent = Extract<MarketingContent, { kind: "cta-cluster" }>;

type ComparisonTableContent = Extract<MarketingContent, { kind: "comparison-table" }>;

const renderHeroBlock = (content: HeroContent) => {
  const primaryCta =
    content.primaryCtaHref || content.primaryCtaLabel
      ? {
          label: content.primaryCtaLabel,
          href: content.primaryCtaHref
        }
      : undefined;
  const secondaryCta =
    content.secondaryCtaHref || content.secondaryCtaLabel
      ? {
          label: content.secondaryCtaLabel,
          href: content.secondaryCtaHref
        }
      : undefined;

  return (
    <HeroCallout
      key={content.key ?? content.headline ?? content.eyebrow ?? "hero"}
      eyebrow={content.eyebrow}
      headline={content.headline}
      body={content.body}
      primaryCta={primaryCta}
      secondaryCta={secondaryCta}
      align={content.align}
    />
  );
};

const renderMetricsBlock = (content: MetricsContent, fallback: MetricItem[]) => {
  const metrics = content.metrics.length > 0 ? content.metrics : fallback;
  return (
    <MetricGrid
      key={content.key ?? content.heading ?? "metrics"}
      heading={content.heading}
      subheading={content.subheading}
      metrics={metrics}
    />
  );
};

const renderTestimonialBlock = (content: TestimonialContent) => {
  return (
    <TestimonialCallout
      key={content.key ?? content.quote}
      quote={content.quote}
      author={content.author}
      role={content.role}
      company={content.company}
    />
  );
};

const renderProductBlock = (content: ProductContent) => {
  const features = content.features.length > 0 ? content.features : undefined;
  return (
    <ProductCard
      key={content.key ?? content.name ?? content.badge ?? "product"}
      badge={content.badge}
      name={content.name}
      description={content.description}
      price={content.price}
      currency={content.currency}
      frequency={content.frequency}
      features={features}
      ctaLabel={content.ctaLabel}
      ctaHref={content.ctaHref}
    />
  );
};

const renderTimelineBlock = (content: TimelineContent) => {
  return (
    <TimelineShowcase
      key={content.key ?? content.heading ?? "timeline"}
      heading={content.heading}
      subheading={content.subheading}
      items={content.items}
    />
  );
};

const renderFeatureGridBlock = (content: FeatureGridContent) => {
  return (
    <FeatureGrid
      key={content.key ?? content.heading ?? "feature-grid"}
      heading={content.heading}
      subheading={content.subheading}
      features={content.features}
      columns={content.columns}
    />
  );
};

const renderMediaGalleryBlock = (content: MediaGalleryContent) => {
  return (
    <MediaGallery
      key={content.key ?? content.heading ?? "media-gallery"}
      heading={content.heading}
      subheading={content.subheading}
      media={content.media}
      columns={content.columns}
    />
  );
};

const renderCtaClusterBlock = (content: CtaClusterContent) => {
  return (
    <CtaCluster
      key={content.key ?? content.heading ?? "cta-cluster"}
      heading={content.heading}
      subheading={content.subheading}
      align={content.align}
      ctas={content.ctas}
    />
  );
};

const renderComparisonTableBlock = (content: ComparisonTableContent) => {
  return (
    <ComparisonTable
      key={content.key ?? content.heading ?? "comparison-table"}
      heading={content.heading}
      subheading={content.subheading}
      columns={content.columns}
      rows={content.rows}
    />
  );
};

const renderMarketingBlocks = (
  section: SectionBlock,
  marketingContent: MarketingContent[],
  metricFallback: MetricItem[]
) => {
  return marketingContent.map((content, index) => {
    const key = content.key ?? `${content.kind}-${index}`;

    switch (content.kind) {
      case "hero":
        return renderHeroBlock({ ...content, key });
      case "metrics": {
        const fallback = resolveMetricsFallback(section, metricFallback);
        return renderMetricsBlock({ ...content, key }, fallback);
      }
      case "testimonial":
        return renderTestimonialBlock({ ...content, key });
      case "product":
        return renderProductBlock({ ...content, key });
      case "timeline":
        return renderTimelineBlock({ ...content, key });
      case "feature-grid":
        return renderFeatureGridBlock({ ...content, key });
      case "media-gallery":
        return renderMediaGalleryBlock({ ...content, key });
      case "cta-cluster":
        return renderCtaClusterBlock({ ...content, key });
      case "comparison-table":
        return renderComparisonTableBlock({ ...content, key });
      default:
        return null;
    }
  });
};

const renderTestimonialQuote = (section: TestimonialBlock) => {
  return (
    <blockquote className="rounded-3xl border border-white/10 bg-white/5 p-10 text-left shadow-lg backdrop-blur">
      <p className="text-xl italic text-white/80">“{section.quote}”</p>
      <footer className="mt-6 text-sm text-white/60">
        {section.author ? <span className="font-semibold text-white">{section.author}</span> : null}
        {section.role ? <span> · {section.role}</span> : null}
        {section.company ? <span> @ {section.company}</span> : null}
      </footer>
    </blockquote>
  );
};

const renderLegacySection = (
  section: SectionBlock,
  sectionContentClassName: string,
  metricFallback: MetricItem[]
) => {
  const key = section._key ?? section.heading ?? section.layout ?? "section";
  const layout = section.layout ?? "two-column";

  if (layout === "metrics") {
    const metrics = section.metrics?.length ? section.metrics : metricFallback;
    return (
      <div key={key} className="space-y-6 text-center">
        {section.heading ? <h2 className="text-3xl font-semibold">{section.heading}</h2> : null}
        {section.subheading ? <p className="mx-auto max-w-3xl text-white/70">{section.subheading}</p> : null}
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center backdrop-blur"
            >
              <p className="text-3xl font-semibold">{metric.value}</p>
              <p className="mt-2 text-sm uppercase tracking-wide text-white/60">{metric.label}</p>
              {metric.description ? <p className="mt-3 text-sm text-white/50">{metric.description}</p> : null}
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
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <FaqAccordion items={faqItems} />
      </div>
    );
  }

  if (layout === "testimonials" && section.testimonials?.length) {
    return (
      <div key={key} className="space-y-6">
        {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <TestimonialHighlights items={section.testimonials} />
      </div>
    );
  }

  if (layout === "case-study" && section.caseStudy) {
    return (
      <div key={key} className="space-y-6">
        {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <CaseStudyHighlight caseStudy={section.caseStudy} />
      </div>
    );
  }

  if (layout === "pricing" && section.pricingTiers?.length) {
    return (
      <div key={key} className="space-y-8">
        {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <PricingGrid tiers={section.pricingTiers} />
      </div>
    );
  }

  if (layout === "blog" && section.blogPosts?.length) {
    return (
      <div key={key} className="space-y-6">
        {section.heading ? <h2 className="text-3xl font-semibold text-center">{section.heading}</h2> : null}
        {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
        <PostList posts={section.blogPosts} />
      </div>
    );
  }

  return (
    <div key={key} className="space-y-4 text-center">
      {section.heading ? <h2 className="text-3xl font-semibold">{section.heading}</h2> : null}
      {section.subheading ? <p className="mx-auto max-w-3xl text-white/70">{section.subheading}</p> : null}
      {section.content ? <RichText value={section.content} lexicalClassName={sectionContentClassName} /> : null}
    </div>
  );
};

export function MarketingSections({
  sections,
  sectionContentClassName,
  metricFallback = DEFAULT_METRIC_FALLBACK,
  id
}: MarketingSectionsProps) {
  if (!sections || sections.length === 0) {
    return null;
  }

  return (
    <section id={id} className="mx-auto flex w-full max-w-5xl flex-col gap-16">
      {sections.map((section) => {
        if (section._type === "testimonial") {
          return renderTestimonialQuote(section as TestimonialBlock);
        }

        const sectionBlock = section as SectionBlock;
        const marketingContent = resolveMarketingContent(sectionBlock);

        if (marketingContent.length > 0) {
          return (
            <div key={sectionBlock._key ?? sectionBlock.heading ?? "marketing"} className="flex flex-col gap-12">
              {renderMarketingBlocks(sectionBlock, marketingContent, metricFallback)}
            </div>
          );
        }

        return renderLegacySection(sectionBlock, sectionContentClassName, metricFallback);
      })}
    </section>
  );
}

export const defaultMarketingMetricsFallback = DEFAULT_METRIC_FALLBACK;
