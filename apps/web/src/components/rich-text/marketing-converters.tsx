import { type JSXConverters } from "@payloadcms/richtext-lexical/react";
import type { SerializedBlockNode } from "@payloadcms/richtext-lexical";

import { HeroCallout } from "./marketing/hero-callout";
import { MetricGrid, type MetricItem } from "./marketing/metric-grid";
import { ProductCard, type ProductFeature } from "./marketing/product-card";
import { TestimonialCallout } from "./marketing/testimonial-callout";

type HeroBlockNode = SerializedBlockNode<{
  blockType: "marketing-hero";
  blockName?: string;
  eyebrow?: string;
  headline?: string;
  body?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  align?: "start" | "center";
}>;

type MetricsBlockNode = SerializedBlockNode<{
  blockType: "marketing-metrics";
  blockName?: string;
  heading?: string;
  subheading?: string;
  metrics?: MetricItem[];
}>;

type TestimonialBlockNode = SerializedBlockNode<{
  blockType: "marketing-testimonial";
  blockName?: string;
  quote?: string;
  author?: string;
  role?: string;
  company?: string;
}>;

type ProductBlockNode = SerializedBlockNode<{
  blockType: "marketing-product-card";
  blockName?: string;
  badge?: string;
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  frequency?: string;
  features?: ProductFeature[];
  ctaLabel?: string;
  ctaHref?: string;
}>;

const toMetricItems = (node: MetricsBlockNode): MetricItem[] => {
  const metrics = node.fields.metrics;
  if (!Array.isArray(metrics)) {
    return [];
  }
  return metrics.map((metric) => ({
    label: typeof metric?.label === "string" ? metric.label : undefined,
    value: typeof metric?.value === "string" ? metric.value : undefined,
    description: typeof metric?.description === "string" ? metric.description : undefined,
  }));
};

const toProductFeatures = (node: ProductBlockNode): ProductFeature[] => {
  const features = node.fields.features;
  if (!Array.isArray(features)) {
    return [];
  }
  return features
    .map((feature) => ({
      id: typeof feature?.id === "string" ? feature.id : undefined,
      label: typeof feature?.label === "string" ? feature.label : undefined,
    }))
    .filter((feature) => feature.label);
};

export const marketingLexicalConverters: JSXConverters = {
  blocks: {
    "marketing-hero": ({ node }) => {
      const heroNode = node as HeroBlockNode;
      const { fields } = heroNode;
      return (
        <HeroCallout
          eyebrow={typeof fields.eyebrow === "string" ? fields.eyebrow : undefined}
          headline={typeof fields.headline === "string" ? fields.headline : undefined}
          body={typeof fields.body === "string" ? fields.body : undefined}
          primaryCta={{
            label: typeof fields.primaryCtaLabel === "string" ? fields.primaryCtaLabel : undefined,
            href: typeof fields.primaryCtaHref === "string" ? fields.primaryCtaHref : undefined,
          }}
          secondaryCta={{
            label: typeof fields.secondaryCtaLabel === "string" ? fields.secondaryCtaLabel : undefined,
            href: typeof fields.secondaryCtaHref === "string" ? fields.secondaryCtaHref : undefined,
          }}
          align={fields.align === "start" ? "start" : "center"}
        />
      );
    },
    "marketing-metrics": ({ node }) => {
      const metricsNode = node as MetricsBlockNode;
      const metrics = toMetricItems(metricsNode);
      return (
        <MetricGrid
          heading={typeof metricsNode.fields.heading === "string" ? metricsNode.fields.heading : undefined}
          subheading={
            typeof metricsNode.fields.subheading === "string" ? metricsNode.fields.subheading : undefined
          }
          metrics={metrics}
        />
      );
    },
    "marketing-testimonial": ({ node }) => {
      const testimonialNode = node as TestimonialBlockNode;
      const { fields } = testimonialNode;
      return (
        <TestimonialCallout
          quote={typeof fields.quote === "string" ? fields.quote : ""}
          author={typeof fields.author === "string" ? fields.author : undefined}
          role={typeof fields.role === "string" ? fields.role : undefined}
          company={typeof fields.company === "string" ? fields.company : undefined}
        />
      );
    },
    "marketing-product-card": ({ node }) => {
      const productNode = node as ProductBlockNode;
      const { fields } = productNode;
      const features = toProductFeatures(productNode);
      return (
        <ProductCard
          badge={typeof fields.badge === "string" ? fields.badge : undefined}
          name={typeof fields.name === "string" ? fields.name : undefined}
          description={typeof fields.description === "string" ? fields.description : undefined}
          price={typeof fields.price === "number" ? fields.price : undefined}
          currency={typeof fields.currency === "string" ? fields.currency : undefined}
          frequency={typeof fields.frequency === "string" ? fields.frequency : undefined}
          features={features}
          ctaLabel={typeof fields.ctaLabel === "string" ? fields.ctaLabel : undefined}
          ctaHref={typeof fields.ctaHref === "string" ? fields.ctaHref : undefined}
        />
      );
    },
  },
};
