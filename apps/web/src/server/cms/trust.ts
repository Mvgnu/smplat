import { cache } from "react";

import { z } from "zod";

import { isPayload, payloadConfig, payloadGet } from "./client";

export type CheckoutAssurancePoint = {
  id: string;
  title: string;
  description: string;
  evidence?: string;
};

export type CheckoutSupportChannel = {
  id: string;
  channel: string;
  label: string;
  target: string;
  availability?: string;
};

export type CheckoutPerformanceSnapshot = {
  id: string;
  label: string;
  value: string;
  caption?: string;
};

export type CheckoutTestimonial = {
  id: string;
  quote: string;
  author: string;
  role?: string;
};

export type CheckoutBundleOffer = {
  id: string;
  slug: string;
  title: string;
  description: string;
  savings?: string;
};

export type CheckoutTrustExperience = {
  guaranteeHeadline: string;
  guaranteeDescription: string;
  assurances: CheckoutAssurancePoint[];
  supportChannels: CheckoutSupportChannel[];
  performanceSnapshots: CheckoutPerformanceSnapshot[];
  testimonials: CheckoutTestimonial[];
  bundleOffers: CheckoutBundleOffer[];
};

const checkoutTrustSchema = z.object({
  guaranteeHeadline: z.string().optional(),
  guaranteeDescription: z.string().optional(),
  assurancePoints: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        evidence: z.string().optional(),
      })
    )
    .optional(),
  supportChannels: z
    .array(
      z.object({
        id: z.string().optional(),
        channel: z.string().optional(),
        label: z.string().optional(),
        target: z.string().optional(),
        availability: z.string().optional(),
      })
    )
    .optional(),
  performanceSnapshots: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().optional(),
        value: z.string().optional(),
        caption: z.string().optional(),
      })
    )
    .optional(),
  testimonials: z
    .array(
      z.object({
        id: z.string().optional(),
        quote: z.string().optional(),
        author: z.string().optional(),
        role: z.string().optional(),
      })
    )
    .optional(),
  bundleOffers: z
    .array(
      z.object({
        id: z.string().optional(),
        slug: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        savings: z.string().optional(),
      })
    )
    .optional(),
});

const fallbackExperience: CheckoutTrustExperience = {
  guaranteeHeadline: "SMPLAT Delivery Assurance",
  guaranteeDescription:
    "Every campaign is backed by verified operators, guaranteed kickoff timelines, and concierge support before you pay.",
  assurances: [
    {
      id: "guarantee",
      title: "14-day launch or we credit your first sprint",
      description:
        "If we miss the onboarding window, the first sprint fee is credited back—no negotiation required.",
      evidence: "Tracked via fulfillment SLA snapshots and customer CSAT logs.",
    },
    {
      id: "delivery",
      title: "Campaign milestones audited weekly",
      description:
        "Operators log deliverables in the client portal with timestamped evidence so finance and marketing stay aligned.",
    },
    {
      id: "compliance",
      title: "Compliance-ready workflows",
      description:
        "Meta, TikTok, and FTC guardrails are embedded into each workflow with automated checks before campaigns go live.",
    },
  ],
  supportChannels: [
    {
      id: "slack",
      channel: "slack",
      label: "Join the concierge Slack",
      target: "https://smplat.com/concierge-slack",
      availability: "Available 08:00–22:00 CET",
    },
    {
      id: "email",
      channel: "email",
      label: "Email the operator desk",
      target: "concierge@smplat.com",
    },
    {
      id: "call",
      channel: "phone",
      label: "Schedule a strategy call",
      target: "tel:+442045772901",
      availability: "Same-day slots across EU/US time zones",
    },
  ],
  performanceSnapshots: [
    { id: "followers", label: "Avg follower lift in 60 days", value: "+3.8k", caption: "Across 42 SMB campaigns" },
    { id: "retention", label: "Client retention after 2 sprints", value: "92%", caption: "Tracked in billing ledger" },
    { id: "csat", label: "Support satisfaction", value: "4.9/5", caption: "Post-onboarding CSAT responses" },
  ],
  testimonials: [
    {
      id: "atlas",
      quote:
        "SMPLAT had us onboarding creators and shipping paid experiments inside ten days. Finance saw the guarantees before we paid—made the approval instant.",
      author: "Amelia Richter",
      role: "Founder, Atlas Creative Studio",
    },
    {
      id: "nova",
      quote:
        "The concierge desk handled every escalation in Slack with receipts from the operator dashboard. It feels like an extension of our growth team.",
      author: "David Mensah",
      role: "Growth Lead, Nova Brands",
    },
  ],
  bundleOffers: [
    {
      id: "instagram-tiktok",
      slug: "instagram-growth+tiktok-ads",
      title: "Instagram Growth + TikTok Ads Accelerator",
      description: "Sync creative learnings across platforms and unlock combined reporting dashboards.",
      savings: "Save 12%",
    },
    {
      id: "ugc",
      slug: "instagram-growth+ugc-lab",
      title: "Growth Campaign + UGC Lab",
      description: "Pair sustained growth with fresh creator assets and publishing operations.",
      savings: "Save 8%",
    },
  ],
};

const normalizeCheckoutTrust = (doc: unknown): CheckoutTrustExperience | null => {
  const parsed = checkoutTrustSchema.safeParse(doc);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;

  return {
    guaranteeHeadline: data.guaranteeHeadline ?? fallbackExperience.guaranteeHeadline,
    guaranteeDescription: data.guaranteeDescription ?? fallbackExperience.guaranteeDescription,
    assurances: (data.assurancePoints ?? [])
      .map((item, index) => {
        const title = item.title ?? item.description;
        const description = item.description ?? "";
        if (!title) {
          return null;
        }
        return {
          id: item.id ?? `assurance-${index}`,
          title,
          description,
          evidence: item.evidence ?? undefined,
        } satisfies CheckoutAssurancePoint;
      })
      .filter(Boolean) as CheckoutAssurancePoint[],
    supportChannels: (data.supportChannels ?? [])
      .map((item, index) => {
        if (!item.channel || !item.label || !item.target) {
          return null;
        }
        return {
          id: item.id ?? `support-${index}`,
          channel: item.channel,
          label: item.label,
          target: item.target,
          availability: item.availability ?? undefined,
        } satisfies CheckoutSupportChannel;
      })
      .filter(Boolean) as CheckoutSupportChannel[],
    performanceSnapshots: (data.performanceSnapshots ?? [])
      .map((item, index) => {
        if (!item.label || !item.value) {
          return null;
        }
        return {
          id: item.id ?? `snapshot-${index}`,
          label: item.label,
          value: item.value,
          caption: item.caption ?? undefined,
        } satisfies CheckoutPerformanceSnapshot;
      })
      .filter(Boolean) as CheckoutPerformanceSnapshot[],
    testimonials: (data.testimonials ?? [])
      .map((item, index) => {
        if (!item.quote) {
          return null;
        }
        return {
          id: item.id ?? `testimonial-${index}`,
          quote: item.quote,
          author: item.author ?? "SMPLAT client",
          role: item.role ?? undefined,
        } satisfies CheckoutTestimonial;
      })
      .filter(Boolean) as CheckoutTestimonial[],
    bundleOffers: (data.bundleOffers ?? [])
      .map((item, index) => {
        if (!item.slug || !item.title || !item.description) {
          return null;
        }
        return {
          id: item.id ?? `bundle-${index}`,
          slug: item.slug,
          title: item.title,
          description: item.description,
          savings: item.savings ?? undefined,
        } satisfies CheckoutBundleOffer;
      })
      .filter(Boolean) as CheckoutBundleOffer[],
  } satisfies CheckoutTrustExperience;
};

export const getCheckoutTrustExperience = cache(async (): Promise<CheckoutTrustExperience> => {
  if (!isPayload()) {
    return fallbackExperience;
  }

  try {
    const env = payloadConfig.environment;
    const data = await payloadGet<{ docs?: unknown[] }>({
      path: "/api/checkout-trust-experiences",
      query: {
        "where[slug][equals]": "checkout",
        "where[environment][equals]": env,
        limit: 1,
        draft: undefined,
      },
    });

    const experience = normalizeCheckoutTrust(data.docs?.[0]);
    if (!experience) {
      return fallbackExperience;
    }

    return {
      ...fallbackExperience,
      ...experience,
      assurances: experience.assurances.length > 0 ? experience.assurances : fallbackExperience.assurances,
      supportChannels:
        experience.supportChannels.length > 0 ? experience.supportChannels : fallbackExperience.supportChannels,
      performanceSnapshots:
        experience.performanceSnapshots.length > 0
          ? experience.performanceSnapshots
          : fallbackExperience.performanceSnapshots,
      testimonials: experience.testimonials.length > 0 ? experience.testimonials : fallbackExperience.testimonials,
      bundleOffers: experience.bundleOffers.length > 0 ? experience.bundleOffers : fallbackExperience.bundleOffers,
    } satisfies CheckoutTrustExperience;
  } catch (error) {
    console.warn("Failed to fetch checkout trust experience from Payload", error);
    return fallbackExperience;
  }
});
