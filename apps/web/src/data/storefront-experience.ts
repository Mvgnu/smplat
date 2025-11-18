import type { MarketingContentDocument, PageDocument } from "@/server/cms/types";

export type TrustBadge = {
  id: string;
  label: string;
  value: string;
  description: string;
};

export type StorefrontHeroContent = {
  eyebrow: string;
  headline: string;
  subheadline: string;
  primaryCta: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
  highlights: TrustBadge[];
};

export type TrustMetric = {
  id: string;
  label: string;
  value: string;
  description: string;
  trendLabel: string;
  trendValue: string;
  trendDirection: "up" | "flat" | "down";
};

export type PlatformContext = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
};

export type ProductHighlight = {
  id: string;
  label: string;
};

export type LoyaltyHint = {
  value: string;
  reward: string;
  progress: number;
  pointsEstimate?: number;
};

export type StorefrontProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  price: string;
  frequency: string;
  badge?: string;
  highlights: ProductHighlight[];
  eligibility: string[];
  trustSignal: {
    value: string;
    label: string;
  };
  journeyInsight: string;
  loyaltyHint: LoyaltyHint;
  sla: string;
  ctaLabel: string;
  ctaHref: string;
};

export type StorefrontTestimonial = {
  id: string;
  quote: string;
  author: string;
  role: string;
  metric: string;
};

export type RewardCallout = {
  id: string;
  title: string;
  description: string;
  progress: number;
  rewardValue: string;
  timeline: string;
};

export type StorefrontRewards = {
  heading: string;
  subheading: string;
  callouts: RewardCallout[];
};

export type StorefrontExperience = {
  hero: StorefrontHeroContent;
  trustMetrics: TrustMetric[];
  platforms: PlatformContext[];
  products: StorefrontProduct[];
  testimonials: StorefrontTestimonial[];
  rewards: StorefrontRewards;
};

export const storefrontExperience: StorefrontExperience = {
  hero: {
    eyebrow: "Social growth storefront",
    headline: "Order Instagram, TikTok, and YouTube growth drops with real proof.",
    subheadline:
      "Pick a ready-made campaign, attach your saved handle, and track fulfillment through receipts, screenshots, and workflow telemetry. No pitches or guesswork — just transparent delivery backed by live metrics.",
    primaryCta: {
      label: "Shop campaigns",
      href: "/products"
    },
    secondaryCta: {
      label: "Preview trust signals",
      href: "/trust-preview"
    },
    highlights: [
      {
        id: "orders",
        label: "Orders fulfilled",
        value: "2,400+",
        description: "Completed drops since January with verified receipts."
      },
      {
        id: "lift",
        label: "Avg follower lift",
        value: "+3.1%",
        description: "Measured from baseline snapshots per platform."
      },
      {
        id: "repeat",
        label: "Repeat buyers",
        value: "67%",
        description: "Customers who booked a second drop in the last quarter."
      }
    ]
  },
  trustMetrics: [
    {
      id: "proof",
      label: "Proof-of-delivery coverage",
      value: "99.1%",
      description: "Orders shipped with receipts, screenshots, and guardrail notes.",
      trendLabel: "last 60 days",
      trendValue: "+1.4%",
      trendDirection: "up"
    },
    {
      id: "fulfillment",
      label: "Avg fulfillment window",
      value: "4.4 days",
      description: "Weighted across Instagram, TikTok, and YouTube mixes.",
      trendLabel: "SLA variance",
      trendValue: "-0.6 days",
      trendDirection: "up"
    },
    {
      id: "lift-metric",
      label: "Median follower lift",
      value: "+2.8%",
      description: "Calibrated from post-delivery baselines per order.",
      trendLabel: "vs. prior month",
      trendValue: "+0.4%",
      trendDirection: "up"
    },
    {
      id: "loyalty",
      label: "Loyalty value unlocked",
      value: "22%",
      description: "Average savings from repeat-order rewards and refill credits.",
      trendLabel: "quarterly redemption rate",
      trendValue: "+5.1%",
      trendDirection: "up"
    }
  ],
  platforms: [
    {
      id: "instagram",
      name: "Instagram",
      tagline: "Creator storefronts",
      description: "Reels, Shops, and Collabs automation routed through trusted providers.",
      accent: "from-pink-500/80 to-purple-500/80"
    },
    {
      id: "tiktok",
      name: "TikTok",
      tagline: "Pulse-ready drops",
      description: "Spark Ads, TikTok Shop, and live drops with refill triggers baked in.",
      accent: "from-slate-100/70 to-blue-500/70"
    },
    {
      id: "youtube",
      name: "YouTube",
      tagline: "Channel expansion",
      description: "Community posts, live shopping, and Shorts conversion boosts.",
      accent: "from-amber-400/80 to-red-500/80"
    }
  ],
  products: [
    {
      id: "instagram-growth-kit",
      slug: "instagram-growth",
      name: "Instagram Creator Growth Kit",
      category: "Launch Ready",
      summary: "Audience building sprint with media kit refresh, drip sequences, and VIP concierge support.",
      price: "$8,500",
      frequency: "per drop",
      badge: "Best seller",
      highlights: [
        { id: "journey-script", label: "Automated reel + DM scripts" },
        { id: "provider", label: "Creator-safe provider routing" },
        { id: "care", label: "Account care dashboard" }
      ],
      eligibility: ["instagram"],
      trustSignal: {
        value: "96%",
        label: "journeys completed on-time"
      },
      journeyInsight: "Bundles trust metrics + loyalty streak tracking for faster reorders.",
      loyaltyHint: {
        value: "Earn 2,100 pts",
        reward: "Unlock a conversion lab audit",
        progress: 0.65,
        pointsEstimate: 2100
      },
      sla: "Proof-of-launch in 48 hours",
      ctaLabel: "Configure Instagram kit",
      ctaHref: "/products/instagram-growth"
    },
    {
      id: "tiktok-retention-drive",
      slug: "tiktok-growth",
      name: "TikTok Retention Drive",
      category: "Scale",
      summary: "Spark Ads, live drop crew, and refill loops orchestrated from an account dashboard entry point.",
      price: "$12,400",
      frequency: "per cohort",
      highlights: [
        { id: "spark", label: "Spark-ready asset prep" },
        { id: "liveops", label: "Live drop concierge" },
        { id: "telemetry", label: "Real-time refill alerts" }
      ],
      eligibility: ["tiktok"],
      trustSignal: {
        value: "4.2x",
        label: "median ROAS vs. previous cohorts"
      },
      journeyInsight: "Propagates platform metadata straight into automation scripts for each run.",
      loyaltyHint: {
        value: "Earn 3,000 pts",
        reward: "Referral booster credit",
        progress: 0.4,
        pointsEstimate: 3000
      },
      sla: "Refill commitments every 72 hours",
      ctaLabel: "Review TikTok plan",
      ctaHref: "/products/tiktok-retention"
    },
    {
      id: "platform-commerce-starter",
      slug: "platform-commerce-starter",
      name: "Platform Commerce Starter",
      category: "Lifecycle",
      summary: "Cross-channel starter kit with shared billing, invoice automation, and rewards pre-wired.",
      price: "$4,200",
      frequency: "per month",
      highlights: [
        { id: "billing", label: "Unified billing + tax profiles" },
        { id: "rewards", label: "Checkout intents widgets" },
        { id: "reporting", label: "Performance dashboard seed" }
      ],
      eligibility: ["instagram", "tiktok", "youtube"],
      trustSignal: {
        value: "5.1 days",
        label: "average billing to delivery window"
      },
      journeyInsight: "Pairs account-level telemetry with loyalty nudges to encourage larger baskets.",
      loyaltyHint: {
        value: "Earn 1,250 pts",
        reward: "Account performance review",
        progress: 0.8,
        pointsEstimate: 1250
      },
      sla: "Billing + reporting live in 7 days",
      ctaLabel: "Launch multi-platform kit",
      ctaHref: "/products/platform-commerce-starter"
    }
  ],
  testimonials: [
    {
      id: "agency-north",
      quote:
        "We now launch Instagram drops directly from saved platform profiles. Trust metrics at checkout cut buyer hesitation in half.",
      author: "Maya Collins",
      role: "Director of Growth, Agency North",
      metric: "+28% faster reorders"
    },
    {
      id: "orbit-studios",
      quote:
        "TikTok refills trigger from account telemetry, and the dashboard mirrors what ops sees. Clients finally believe the promised SLA.",
      author: "Luis Alvarez",
      role: "Partner, Orbit Studios",
      metric: "4.1x retention lift"
    },
    {
      id: "creatorhouse",
      quote:
        "Reward streaks sit next to invoices, so finance and CM teams stay aligned. The storefront feels more like a control room.",
      author: "Ivy Chen",
      role: "COO, Creator House",
      metric: "92% billing automation adoption"
    }
  ],
  rewards: {
    heading: "Rewards and intents fuel larger carts",
    subheading:
      "Nudges follow the customer from storefront to checkout to account, aligning rewards with every purchase intent.",
    callouts: [
      {
        id: "intent-swap",
        title: "Intent-aware checkout",
        description: "Customers can swap pending rewards during checkout to match their current goal.",
        progress: 0.55,
        rewardValue: "Typical +14% order value",
        timeline: "Available now"
      },
      {
        id: "streaks",
        title: "Fulfillment streak badges",
        description: "Platform account dashboards highlight streaks that unlock bonus audits.",
        progress: 0.7,
        rewardValue: "Unlocks 1:1 ops huddles",
        timeline: "Beta this quarter"
      },
      {
        id: "referral",
        title: "Referral boosters",
        description: "Reward tiers multiply when referrals convert within 30 days of a drop.",
        progress: 0.35,
        rewardValue: "+20% point multiplier",
        timeline: "Pilot with 8 agencies"
      }
    ]
  }
};

type PageSection = Extract<NonNullable<PageDocument["content"]>[number], { _type: "section" }>;
type ProductContent = Extract<MarketingContentDocument, { kind: "product" }>;

const toSections = (page?: PageDocument | null) =>
  (page?.content ?? []).filter((block): block is PageSection => block?._type === "section");

const extractMetricOverrides = (sections: PageSection[]) => {
  for (const section of sections) {
    if (section.metrics?.length) {
      return section.metrics;
    }
  }
  return undefined;
};

const collectTestimonials = (page?: PageDocument | null) => {
  const testimonials: Array<{
    quote: string;
    author?: string;
    role?: string;
    company?: string;
  }> = [];

  const sections = page?.content ?? [];
  for (const block of sections) {
    if (!block) continue;
    if (block._type === "testimonial") {
      testimonials.push({
        quote: block.quote,
        author: block.author,
        role: block.role,
        company: block.company
      });
      continue;
    }

    if (block._type === "section" && block.testimonials?.length) {
      testimonials.push(
        ...block.testimonials.map((testimonial) => ({
          quote: testimonial.quote,
          author: testimonial.author,
          role: testimonial.role,
          company: testimonial.company
        }))
      );
    }
  }

  return testimonials;
};

const collectProductContent = (sections: PageSection[]) => {
  const products: ProductContent[] = [];
  for (const section of sections) {
    if (!section.marketingContent?.length) {
      continue;
    }
    const productBlocks = section.marketingContent.filter(
      (content): content is ProductContent => content.kind === "product"
    );
    products.push(...productBlocks);
  }
  return products;
};

const formatCurrency = (amount: number, currency?: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0
    }).format(amount);
  } catch (error) {
    console.warn("Failed to format currency", error);
    return `$${amount.toLocaleString()}`;
  }
};

const mergeHighlights = (fallback: ProductHighlight[], content: ProductContent | undefined) => {
  if (!content?.features?.length) {
    return fallback;
  }
  return content.features.map((feature, index) => ({
    id: feature.id ?? `${content.key ?? "product"}-feature-${index}`,
    label: feature.label ?? fallback[index % fallback.length]?.label ?? "Feature"
  }));
};

const mergeProducts = (fallback: StorefrontProduct[], productContent: ProductContent[]) => {
  if (!productContent.length) {
    return fallback;
  }

  return fallback.map((product, index) => {
    const override = productContent[index];
    if (!override) {
      return product;
    }

    const formattedPrice =
      typeof override.price === "number" ? formatCurrency(override.price, override.currency) : undefined;

    return {
      ...product,
      name: override.name ?? product.name,
      summary: override.description ?? product.summary,
      price: formattedPrice ?? product.price,
      frequency: override.frequency ?? product.frequency,
      badge: override.badge ?? product.badge,
      highlights: mergeHighlights(product.highlights, override),
      ctaLabel: override.ctaLabel ?? product.ctaLabel,
      ctaHref: override.ctaHref ?? product.ctaHref
    };
  });
};

const mergeTestimonials = (
  fallback: StorefrontTestimonial[],
  overrides: ReturnType<typeof collectTestimonials>
): StorefrontTestimonial[] => {
  if (!overrides.length) {
    return fallback;
  }

  return fallback.map((testimonial, index) => {
    const override = overrides[index];
    if (!override) {
      return testimonial;
    }
    return {
      ...testimonial,
      quote: override.quote ?? testimonial.quote,
      author: override.author ?? testimonial.author,
      role: override.role ?? testimonial.role,
      metric: testimonial.metric
    };
  });
};

const mergeTrustMetrics = (
  fallback: TrustMetric[],
  overrides: ReturnType<typeof extractMetricOverrides>
): TrustMetric[] => {
  if (!overrides?.length) {
    return fallback;
  }

  return fallback.map((metric, index) => {
    const override = overrides[index];
    if (!override) {
      return metric;
    }
    return {
      ...metric,
      label: override.label ?? metric.label,
      value: override.value ?? metric.value,
      description: override.description ?? metric.description
    };
  });
};

export function resolveStorefrontExperience(page?: PageDocument | null): StorefrontExperience {
  const sections = toSections(page);
  const base = storefrontExperience;

  const hero: StorefrontHeroContent = {
    ...base.hero,
    eyebrow: page?.hero?.eyebrow ?? base.hero.eyebrow,
    headline: page?.hero?.headline ?? base.hero.headline,
    subheadline: page?.hero?.subheadline ?? base.hero.subheadline,
    primaryCta:
      page?.hero?.cta?.href != null
        ? {
            label: page.hero.cta.label ?? base.hero.primaryCta.label,
            href: page.hero.cta.href
          }
        : base.hero.primaryCta
  };

  const metricOverrides = extractMetricOverrides(sections);
  const productContent = collectProductContent(sections);
  const testimonialOverrides = collectTestimonials(page);

  return {
    ...base,
    hero,
    trustMetrics: mergeTrustMetrics(base.trustMetrics, metricOverrides),
    products: mergeProducts(base.products, productContent),
    testimonials: mergeTestimonials(base.testimonials, testimonialOverrides)
  };
}

export const getStorefrontProductExperience = (slug: string): StorefrontProduct | undefined => {
  return storefrontExperience.products.find((product) => product.slug === slug);
};
