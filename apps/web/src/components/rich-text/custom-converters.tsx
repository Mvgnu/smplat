import type { JSXConverters } from "@payloadcms/richtext-lexical/react";
import type { SerializedBlockNode } from "@payloadcms/richtext-lexical";

import { HeroCentered } from "./marketing/hero-centered";
import { HeroSplit } from "./marketing/hero-split";
import { HeroMinimal } from "./marketing/hero-minimal";
import { FeatureGridEnhanced } from "./marketing/feature-grid-enhanced";
import { TextImageText } from "./marketing/text-image-text";
import { CtaBanner } from "./marketing/cta-banner";
import { CtaCard } from "./marketing/cta-card";
import { StatsCounter } from "./marketing/stats-counter";
import { PricingCards } from "./marketing/pricing-cards";
import { TestimonialGrid } from "./marketing/testimonial-grid";
import { TeamGallery } from "./marketing/team-gallery";

// Type Definitions for Block Nodes
type HeroCenteredNode = SerializedBlockNode<{
  blockType: "hero-centered";
  blockName?: string;
  headline: string;
  subtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  backgroundPattern?: "none" | "gradient" | "dots" | "grid";
}>;

type HeroSplitNode = SerializedBlockNode<{
  blockType: "hero-split";
  blockName?: string;
  headline: string;
  subtitle?: string;
  bodyText?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  imageUrl?: string;
  imageAlt?: string;
}>;

type HeroMinimalNode = SerializedBlockNode<{
  blockType: "hero-minimal";
  blockName?: string;
  statementText: string;
  subtitle?: string;
  enableScrollAnimation?: boolean;
}>;

type FeatureGridEnhancedNode = SerializedBlockNode<{
  blockType: "feature-grid-enhanced";
  blockName?: string;
  kicker?: string;
  heading?: string;
  subheading?: string;
  columns?: "2" | "3" | "4";
  features: Array<{
    id?: string;
    icon?: string;
    title: string;
    description: string;
    badge?: string;
  }>;
  showNumberBadges?: boolean;
}>;

type TextImageTextNode = SerializedBlockNode<{
  blockType: "text-image-text";
  blockName?: string;
  kicker?: string;
  heading?: string;
  bodyText: string;
  imageUrl: string;
  imageAlt?: string;
  imageSide?: "left" | "right";
  imageSticky?: boolean;
}>;

type CtaBannerNode = SerializedBlockNode<{
  blockType: "cta-banner";
  blockName?: string;
  headline: string;
  subtext?: string;
  ctaLabel: string;
  ctaHref: string;
  backgroundStyle?: "gradient" | "solid-blue" | "solid-gray" | "image";
  backgroundImageUrl?: string;
  stats?: Array<{
    id?: string;
    value: string;
    label: string;
  }>;
}>;

type CtaCardNode = SerializedBlockNode<{
  blockType: "cta-card";
  blockName?: string;
  icon?: string;
  heading: string;
  description: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  illustrationUrl?: string;
}>;

type StatsCounterNode = SerializedBlockNode<{
  blockType: "stats-counter";
  blockName?: string;
  heading?: string;
  subheading?: string;
  stats: Array<{
    id?: string;
    icon?: string;
    value: string;
    label: string;
    description?: string;
  }>;
  layoutStyle?: "grid" | "row";
}>;

type PricingCardsNode = SerializedBlockNode<{
  blockType: "pricing-cards";
  blockName?: string;
  kicker?: string;
  heading?: string;
  subheading?: string;
  enableToggle?: boolean;
  plans: Array<{
    id?: string;
    name: string;
    badge?: string;
    description?: string;
    monthlyPrice: number;
    annualPrice?: number;
    currency?: string;
    features: Array<{
      id?: string;
      text: string;
      included: boolean;
    }>;
    ctaLabel?: string;
    ctaHref?: string;
    highlighted?: boolean;
  }>;
}>;

type TestimonialGridNode = SerializedBlockNode<{
  blockType: "testimonial-grid";
  blockName?: string;
  kicker?: string;
  heading?: string;
  subheading?: string;
  layout?: "grid" | "masonry";
  testimonials: Array<{
    id?: string;
    quote: string;
    author: string;
    role?: string;
    company?: string;
    avatarUrl?: string;
    rating?: number;
    featured?: boolean;
  }>;
}>;

type TeamGalleryNode = SerializedBlockNode<{
  blockType: "team-gallery";
  blockName?: string;
  kicker?: string;
  heading?: string;
  subheading?: string;
  columns?: "2" | "3" | "4";
  members: Array<{
    id?: string;
    name: string;
    role: string;
    department?: string;
    bio?: string;
    imageUrl: string;
    linkedinUrl?: string;
    twitterUrl?: string;
    emailUrl?: string;
  }>;
}>;

// Converter Functions
function withFields<T extends Record<string, unknown>>(
  node: SerializedBlockNode,
  defaults: T
): T {
  return {
    ...defaults,
    ...(((node.fields as Partial<T>) ?? {}) as Partial<T>)
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export const customLexicalConverters: JSXConverters = {
  blocks: {
    "hero-centered": ({ node }) => {
      const fields = withFields<HeroCenteredNode["fields"]>(node, {
        blockType: "hero-centered",
        headline: ""
      });
      return (
        <HeroCentered
          headline={typeof fields.headline === "string" ? fields.headline : ""}
          subtitle={typeof fields.subtitle === "string" ? fields.subtitle : undefined}
          primaryCtaLabel={typeof fields.primaryCtaLabel === "string" ? fields.primaryCtaLabel : undefined}
          primaryCtaHref={typeof fields.primaryCtaHref === "string" ? fields.primaryCtaHref : undefined}
          secondaryCtaLabel={typeof fields.secondaryCtaLabel === "string" ? fields.secondaryCtaLabel : undefined}
          secondaryCtaHref={typeof fields.secondaryCtaHref === "string" ? fields.secondaryCtaHref : undefined}
          backgroundPattern={fields.backgroundPattern || "none"}
        />
      );
    },

    "hero-split": ({ node }) => {
      const fields = withFields<HeroSplitNode["fields"]>(node, {
        blockType: "hero-split",
        headline: "",
        imageUrl: ""
      });
      return (
        <HeroSplit
          headline={typeof fields.headline === "string" ? fields.headline : ""}
          subtitle={typeof fields.subtitle === "string" ? fields.subtitle : undefined}
          bodyText={typeof fields.bodyText === "string" ? fields.bodyText : undefined}
          primaryCtaLabel={typeof fields.primaryCtaLabel === "string" ? fields.primaryCtaLabel : undefined}
          primaryCtaHref={typeof fields.primaryCtaHref === "string" ? fields.primaryCtaHref : undefined}
          secondaryCtaLabel={typeof fields.secondaryCtaLabel === "string" ? fields.secondaryCtaLabel : undefined}
          secondaryCtaHref={typeof fields.secondaryCtaHref === "string" ? fields.secondaryCtaHref : undefined}
          imageUrl={typeof fields.imageUrl === "string" ? fields.imageUrl : undefined}
          imageAlt={typeof fields.imageAlt === "string" ? fields.imageAlt : undefined}
        />
      );
    },

    "hero-minimal": ({ node }) => {
      const fields = withFields<HeroMinimalNode["fields"]>(node, {
        blockType: "hero-minimal",
        statementText: ""
      });
      return (
        <HeroMinimal
          statementText={typeof fields.statementText === "string" ? fields.statementText : ""}
          subtitle={typeof fields.subtitle === "string" ? fields.subtitle : undefined}
          enableScrollAnimation={fields.enableScrollAnimation !== false}
        />
      );
    },

    "feature-grid-enhanced": ({ node }) => {
      const fields = withFields<FeatureGridEnhancedNode["fields"]>(node, {
        blockType: "feature-grid-enhanced",
        features: []
      });
      const features = Array.isArray(fields.features)
        ? fields.features.map((f) => ({
            icon: typeof f?.icon === "string" ? f.icon : undefined,
            title: typeof f?.title === "string" ? f.title : "",
            description: typeof f?.description === "string" ? f.description : "",
            badge: typeof f?.badge === "string" ? f.badge : undefined,
          }))
        : [];
      return (
        <FeatureGridEnhanced
          kicker={typeof fields.kicker === "string" ? fields.kicker : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          subheading={typeof fields.subheading === "string" ? fields.subheading : undefined}
          columns={fields.columns || "3"}
          features={features}
          showNumberBadges={fields.showNumberBadges || false}
        />
      );
    },

    "text-image-text": ({ node }) => {
      const fields = withFields<TextImageTextNode["fields"]>(node, {
        blockType: "text-image-text",
        bodyText: "",
        imageUrl: ""
      });
      return (
        <TextImageText
          kicker={typeof fields.kicker === "string" ? fields.kicker : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          bodyText={typeof fields.bodyText === "string" ? fields.bodyText : ""}
          imageUrl={typeof fields.imageUrl === "string" ? fields.imageUrl : ""}
          imageAlt={typeof fields.imageAlt === "string" ? fields.imageAlt : undefined}
          imageSide={fields.imageSide || "right"}
          imageSticky={fields.imageSticky || false}
        />
      );
    },

    "cta-banner": ({ node }) => {
      const fields = withFields<CtaBannerNode["fields"]>(node, {
        blockType: "cta-banner",
        headline: "",
        ctaLabel: "",
        ctaHref: "",
        stats: []
      });
      const stats = Array.isArray(fields.stats)
        ? fields.stats.map((s) => ({
            value: typeof s?.value === "string" ? s.value : "",
            label: typeof s?.label === "string" ? s.label : "",
          }))
        : undefined;
      return (
        <CtaBanner
          headline={typeof fields.headline === "string" ? fields.headline : ""}
          subtext={typeof fields.subtext === "string" ? fields.subtext : undefined}
          ctaLabel={typeof fields.ctaLabel === "string" ? fields.ctaLabel : ""}
          ctaHref={typeof fields.ctaHref === "string" ? fields.ctaHref : ""}
          backgroundStyle={fields.backgroundStyle || "gradient"}
          backgroundImageUrl={typeof fields.backgroundImageUrl === "string" ? fields.backgroundImageUrl : undefined}
          stats={stats}
        />
      );
    },

    "cta-card": ({ node }) => {
      const fields = withFields<CtaCardNode["fields"]>(node, {
        blockType: "cta-card",
        heading: "",
        description: "",
        primaryCtaLabel: "",
        primaryCtaHref: ""
      });
      return (
        <CtaCard
          icon={typeof fields.icon === "string" ? fields.icon : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : ""}
          description={typeof fields.description === "string" ? fields.description : ""}
          primaryCtaLabel={typeof fields.primaryCtaLabel === "string" ? fields.primaryCtaLabel : ""}
          primaryCtaHref={typeof fields.primaryCtaHref === "string" ? fields.primaryCtaHref : ""}
          secondaryCtaLabel={typeof fields.secondaryCtaLabel === "string" ? fields.secondaryCtaLabel : undefined}
          secondaryCtaHref={typeof fields.secondaryCtaHref === "string" ? fields.secondaryCtaHref : undefined}
          illustrationUrl={typeof fields.illustrationUrl === "string" ? fields.illustrationUrl : undefined}
        />
      );
    },

    "stats-counter": ({ node }) => {
      const fields = withFields<StatsCounterNode["fields"]>(node, {
        blockType: "stats-counter",
        stats: []
      });
      const stats = Array.isArray(fields.stats)
        ? fields.stats.map((s) => ({
            icon: typeof s?.icon === "string" ? s.icon : undefined,
            value: typeof s?.value === "string" ? s.value : "",
            label: typeof s?.label === "string" ? s.label : "",
            description: typeof s?.description === "string" ? s.description : undefined,
          }))
        : [];
      return (
        <StatsCounter
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          subheading={typeof fields.subheading === "string" ? fields.subheading : undefined}
          stats={stats}
          layoutStyle={fields.layoutStyle || "grid"}
        />
      );
    },

    "pricing-cards": ({ node }) => {
      const fields = withFields<PricingCardsNode["fields"]>(node, {
        blockType: "pricing-cards",
        plans: []
      });
      const plans = Array.isArray(fields.plans)
        ? fields.plans.map((p) => ({
            name: typeof p?.name === "string" ? p.name : "",
            badge: typeof p?.badge === "string" ? p.badge : undefined,
            description: typeof p?.description === "string" ? p.description : undefined,
            monthlyPrice: typeof p?.monthlyPrice === "number" ? p.monthlyPrice : 0,
            annualPrice: typeof p?.annualPrice === "number" ? p.annualPrice : undefined,
            currency: typeof p?.currency === "string" ? p.currency : "$",
            features: Array.isArray(p?.features)
              ? p.features.map((f) => ({
                  text: typeof f?.text === "string" ? f.text : "",
                  included: f?.included !== false,
                }))
              : [],
            ctaLabel: typeof p?.ctaLabel === "string" ? p.ctaLabel : undefined,
            ctaHref: typeof p?.ctaHref === "string" ? p.ctaHref : undefined,
            highlighted: p?.highlighted || false,
          }))
        : [];
      return (
        <PricingCards
          kicker={typeof fields.kicker === "string" ? fields.kicker : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          subheading={typeof fields.subheading === "string" ? fields.subheading : undefined}
          enableToggle={fields.enableToggle !== false}
          plans={plans}
        />
      );
    },

    "testimonial-grid": ({ node }) => {
      const fields = withFields<TestimonialGridNode["fields"]>(node, {
        blockType: "testimonial-grid",
        testimonials: []
      });
      const testimonials = Array.isArray(fields.testimonials)
        ? fields.testimonials.map((t) => ({
            quote: typeof t?.quote === "string" ? t.quote : "",
            author: typeof t?.author === "string" ? t.author : "",
            role: typeof t?.role === "string" ? t.role : undefined,
            company: typeof t?.company === "string" ? t.company : undefined,
            avatarUrl: typeof t?.avatarUrl === "string" ? t.avatarUrl : undefined,
            rating: typeof t?.rating === "number" ? t.rating : undefined,
            featured: t?.featured || false,
          }))
        : [];
      return (
        <TestimonialGrid
          kicker={typeof fields.kicker === "string" ? fields.kicker : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          subheading={typeof fields.subheading === "string" ? fields.subheading : undefined}
          layout={fields.layout || "grid"}
          testimonials={testimonials}
        />
      );
    },

    "team-gallery": ({ node }) => {
      const fields = withFields<TeamGalleryNode["fields"]>(node, {
        blockType: "team-gallery",
        members: []
      });
      const members = Array.isArray(fields.members)
        ? fields.members.map((m) => ({
            name: typeof m?.name === "string" ? m.name : "",
            role: typeof m?.role === "string" ? m.role : "",
            department: typeof m?.department === "string" ? m.department : undefined,
            bio: typeof m?.bio === "string" ? m.bio : undefined,
            imageUrl: typeof m?.imageUrl === "string" ? m.imageUrl : "",
            linkedinUrl: typeof m?.linkedinUrl === "string" ? m.linkedinUrl : undefined,
            twitterUrl: typeof m?.twitterUrl === "string" ? m.twitterUrl : undefined,
            emailUrl: typeof m?.emailUrl === "string" ? m.emailUrl : undefined,
          }))
        : [];
      return (
        <TeamGallery
          kicker={typeof fields.kicker === "string" ? fields.kicker : undefined}
          heading={typeof fields.heading === "string" ? fields.heading : undefined}
          subheading={typeof fields.subheading === "string" ? fields.subheading : undefined}
          columns={fields.columns || "3"}
          members={members}
        />
      );
    },
  },
};
