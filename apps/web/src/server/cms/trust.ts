import { cache } from "react";
import "server-only";

import { z } from "zod";

import { isPayload, payloadConfig, payloadGet } from "./client";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const metricPreviewStates = ["fresh", "stale", "missing"] as const;
type MetricPreviewState = (typeof metricPreviewStates)[number];

type MetricBindingInput = {
  metricId?: string | null;
  metricSource?: string | null;
  freshnessWindowMinutes?: number | null;
  previewState?: MetricPreviewState | null;
  provenanceNote?: string | null;
};

export type CheckoutMetricVerification = {
  metricId: string;
  source?: string | null;
  verificationState: "fresh" | "stale" | "missing" | "unsupported" | "preview";
  formattedValue?: string | null;
  rawValue?: number | null;
  computedAt?: string | null;
  freshnessWindowMinutes?: number | null;
  previewState?: MetricPreviewState | null;
  provenanceNote?: string | null;
  sampleSize?: number | null;
  cacheLayer?: string | null;
  cacheRefreshedAt?: string | null;
  cacheExpiresAt?: string | null;
  cacheTtlMinutes?: number | null;
  unsupportedReason?: string | null;
  provenanceNotes?: string[] | null;
};

export type CheckoutAssurancePoint = {
  id: string;
  title: string;
  description: string;
  evidence?: string;
  metric?: CheckoutMetricVerification;
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
  fallbackValue?: string;
  metric?: CheckoutMetricVerification;
};

export type CheckoutTestimonial = {
  id: string;
  quote: string;
  author: string;
  role?: string;
  segment?: string;
};

export type CheckoutBundleOffer = {
  id: string;
  slug: string;
  title: string;
  description: string;
  savings?: string;
};

export type CheckoutTrustExperience = {
  slug: string;
  guaranteeHeadline: string;
  guaranteeDescription: string;
  assurances: CheckoutAssurancePoint[];
  supportChannels: CheckoutSupportChannel[];
  performanceSnapshots: CheckoutPerformanceSnapshot[];
  testimonials: CheckoutTestimonial[];
  bundleOffers: CheckoutBundleOffer[];
};

const metricBindingSchema = z
  .object({
    metricId: z.string().optional(),
    metricSource: z.string().optional(),
    freshnessWindowMinutes: z.number().optional(),
    previewState: z.enum(metricPreviewStates).optional(),
    provenanceNote: z.string().optional(),
  })
  .optional();

const checkoutTrustSchema = z.object({
  slug: z.string().optional(),
  guaranteeHeadline: z.string().optional(),
  guaranteeDescription: z.string().optional(),
  assurancePoints: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        evidence: z.string().optional(),
        metric: metricBindingSchema,
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
        fallbackValue: z.string().optional(),
        metric: metricBindingSchema,
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
        segment: z.string().optional(),
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
  slug: "checkout",
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
    {
      id: "followers",
      label: "Avg follower lift in 60 days",
      value: "+3.8k",
      fallbackValue: "+3.8k",
      caption: "Across 42 SMB campaigns",
    },
    {
      id: "retention",
      label: "Client retention after 2 sprints",
      value: "92%",
      fallbackValue: "92%",
      caption: "Tracked in billing ledger",
    },
    {
      id: "csat",
      label: "Support satisfaction",
      value: "4.9/5",
      fallbackValue: "4.9/5",
      caption: "Post-onboarding CSAT responses",
    },
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

type TrustMetricResolution = {
  metric_id: string;
  value: number | null;
  formatted_value: string | null;
  computed_at: string | null;
  sample_size: number;
  freshness_window_minutes: number | null;
  verification_state: "fresh" | "stale" | "missing" | "unsupported";
  metadata: Record<string, unknown> | null;
  provenance: {
    source: string | null;
    cache_layer: string;
    cache_refreshed_at: string | null;
    cache_expires_at: string | null;
    cache_ttl_minutes: number | null;
    notes: string[] | null;
    unsupported_reason: string | null;
  } | null;
};

type TrustMetricRequestPayload = {
  metric_id: string;
  freshness_window_minutes?: number | null;
};

const cloneMetric = (metric: CheckoutMetricVerification | undefined): CheckoutMetricVerification | undefined => {
  if (!metric) {
    return undefined;
  }

  return {
    metricId: metric.metricId,
    source: metric.source ?? null,
    verificationState: metric.verificationState,
    formattedValue: metric.formattedValue ?? null,
    rawValue: metric.rawValue ?? null,
    computedAt: metric.computedAt ?? null,
    freshnessWindowMinutes: metric.freshnessWindowMinutes ?? null,
    previewState: metric.previewState ?? null,
    provenanceNote: metric.provenanceNote ?? null,
    sampleSize: metric.sampleSize ?? null,
    cacheLayer: metric.cacheLayer ?? null,
    cacheRefreshedAt: metric.cacheRefreshedAt ?? null,
    cacheExpiresAt: metric.cacheExpiresAt ?? null,
    cacheTtlMinutes: metric.cacheTtlMinutes ?? null,
    unsupportedReason: metric.unsupportedReason ?? null,
    provenanceNotes: metric.provenanceNotes ? [...metric.provenanceNotes] : null,
  } satisfies CheckoutMetricVerification;
};

const cloneExperience = (experience: CheckoutTrustExperience): CheckoutTrustExperience => ({
  ...experience,
  assurances: experience.assurances.map((assurance) => ({
    ...assurance,
    metric: cloneMetric(assurance.metric),
  })),
  supportChannels: experience.supportChannels.map((channel) => ({ ...channel })),
  performanceSnapshots: experience.performanceSnapshots.map((snapshot) => ({
    ...snapshot,
    metric: cloneMetric(snapshot.metric),
  })),
  testimonials: experience.testimonials.map((testimonial) => ({ ...testimonial })),
  bundleOffers: experience.bundleOffers.map((bundle) => ({ ...bundle })),
});

const createMetricVerification = (
  binding: MetricBindingInput | undefined,
): CheckoutMetricVerification | undefined => {
  if (!binding?.metricId) {
    return undefined;
  }

  return {
    metricId: binding.metricId,
    source: binding.metricSource ?? null,
    verificationState: binding.previewState ?? "missing",
    previewState: binding.previewState ?? null,
    freshnessWindowMinutes: binding.freshnessWindowMinutes ?? null,
    provenanceNote: binding.provenanceNote ?? null,
    formattedValue: null,
    rawValue: null,
    computedAt: null,
    sampleSize: null,
    cacheLayer: null,
    cacheRefreshedAt: null,
    cacheExpiresAt: null,
    cacheTtlMinutes: null,
    unsupportedReason: null,
    provenanceNotes: null,
  } satisfies CheckoutMetricVerification;
};

const normalizeCheckoutTrust = (doc: unknown): CheckoutTrustExperience | null => {
  const parsed = checkoutTrustSchema.safeParse(doc);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const slug = data.slug ?? "checkout";

  const assurances = (data.assurancePoints ?? [])
    .map((item, index) => {
      const title = item.title ?? item.description;
      const description = item.description ?? "";
      if (!title) {
        return null;
      }

      const metric = createMetricVerification(item.metric ?? undefined);

      return {
        id: item.id ?? `assurance-${index}`,
        title,
        description,
        evidence: item.evidence ?? undefined,
        metric,
      } satisfies CheckoutAssurancePoint;
    })
    .filter(Boolean) as CheckoutAssurancePoint[];

  const supportChannels = (data.supportChannels ?? [])
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
    .filter(Boolean) as CheckoutSupportChannel[];

  const performanceSnapshots = (data.performanceSnapshots ?? [])
    .map((item, index) => {
      const label = item.label ?? undefined;
      const fallbackValue = item.fallbackValue ?? item.value ?? undefined;
      if (!label) {
        return null;
      }

      const metric = createMetricVerification(item.metric ?? undefined);
      const value = fallbackValue ?? "";

      return {
        id: item.id ?? `snapshot-${index}`,
        label,
        value,
        caption: item.caption ?? undefined,
        fallbackValue: fallbackValue ?? undefined,
        metric,
      } satisfies CheckoutPerformanceSnapshot;
    })
    .filter(Boolean) as CheckoutPerformanceSnapshot[];

  const testimonials = (data.testimonials ?? [])
    .map((item, index) => {
      if (!item.quote) {
        return null;
      }

      return {
        id: item.id ?? `testimonial-${index}`,
        quote: item.quote,
        author: item.author ?? "SMPLAT client",
        role: item.role ?? undefined,
        segment: item.segment ?? undefined,
      } satisfies CheckoutTestimonial;
    })
    .filter(Boolean) as CheckoutTestimonial[];

  const bundleOffers = (data.bundleOffers ?? [])
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
    .filter(Boolean) as CheckoutBundleOffer[];

  return {
    slug,
    guaranteeHeadline: data.guaranteeHeadline ?? fallbackExperience.guaranteeHeadline,
    guaranteeDescription: data.guaranteeDescription ?? fallbackExperience.guaranteeDescription,
    assurances,
    supportChannels,
    performanceSnapshots,
    testimonials,
    bundleOffers,
  } satisfies CheckoutTrustExperience;
};

const buildMetricRequests = (
  experience: CheckoutTrustExperience,
): { requests: TrustMetricRequestPayload[]; registry: Map<string, CheckoutMetricVerification[]> } => {
  const registry = new Map<string, CheckoutMetricVerification[]>();

  const register = (metric: CheckoutMetricVerification | undefined) => {
    if (!metric?.metricId) {
      return;
    }

    const list = registry.get(metric.metricId) ?? [];
    list.push(metric);
    registry.set(metric.metricId, list);
  };

  experience.assurances.forEach((assurance) => register(assurance.metric));
  experience.performanceSnapshots.forEach((snapshot) => register(snapshot.metric));

  const requests: TrustMetricRequestPayload[] = [];
  registry.forEach((metrics, metricId) => {
    const freshness = metrics.find((metric) => typeof metric.freshnessWindowMinutes === "number")?.freshnessWindowMinutes;
    requests.push({
      metric_id: metricId,
      freshness_window_minutes: freshness ?? null,
    });
  });

  return { requests, registry };
};

const applyMetricResolution = (
  metric: CheckoutMetricVerification,
  resolution: TrustMetricResolution | undefined,
) => {
  if (!resolution) {
    if (metric.previewState === "fresh") {
      metric.verificationState = "preview";
    } else if (metric.previewState) {
      metric.verificationState = metric.previewState;
    } else {
      metric.verificationState = "missing";
    }
    metric.formattedValue = metric.formattedValue ?? null;
    metric.rawValue = metric.rawValue ?? null;
    metric.computedAt = metric.computedAt ?? null;
    metric.sampleSize = metric.sampleSize ?? null;
    metric.cacheLayer = null;
    metric.cacheRefreshedAt = null;
    metric.cacheExpiresAt = null;
    metric.cacheTtlMinutes = null;
    metric.unsupportedReason = null;
    metric.provenanceNotes = null;
    return;
  }

  metric.verificationState = resolution.verification_state ?? "missing";
  metric.formattedValue = resolution.formatted_value;
  metric.rawValue = typeof resolution.value === "number" ? resolution.value : null;
  metric.computedAt = resolution.computed_at;
  metric.sampleSize = typeof resolution.sample_size === "number" ? resolution.sample_size : null;
  metric.freshnessWindowMinutes =
    resolution.freshness_window_minutes ?? metric.freshnessWindowMinutes ?? null;

  const provenance = resolution.provenance;
  const resolvedSourceFromMetadata = resolution.metadata?.source;

  if (provenance?.source) {
    metric.source = provenance.source;
  } else if (typeof resolvedSourceFromMetadata === "string") {
    metric.source = resolvedSourceFromMetadata;
  }

  metric.cacheLayer = provenance?.cache_layer ?? null;
  metric.cacheRefreshedAt = provenance?.cache_refreshed_at ?? null;
  metric.cacheExpiresAt = provenance?.cache_expires_at ?? null;
  metric.cacheTtlMinutes =
    typeof provenance?.cache_ttl_minutes === "number" ? provenance.cache_ttl_minutes : null;
  metric.unsupportedReason = provenance?.unsupported_reason ?? null;

  const provenanceNotes = provenance?.notes ?? null;
  metric.provenanceNotes = provenanceNotes && provenanceNotes.length > 0 ? [...provenanceNotes] : null;

  if (metric.provenanceNotes?.length) {
    metric.provenanceNote = metric.provenanceNotes[0];
  }

  if (metric.verificationState === "unsupported") {
    metric.provenanceNote =
      metric.provenanceNote ??
      provenance?.notes?.[0] ??
      "Metric not yet supported for this experience.";
  }
};

const fetchTrustMetrics = async (
  slug: string,
  requests: TrustMetricRequestPayload[],
): Promise<TrustMetricResolution[]> => {
  if (!checkoutApiKey || requests.length === 0) {
    return [];
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/trust/experiences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": checkoutApiKey,
      },
      cache: "no-store",
      body: JSON.stringify({ slug, metrics: requests }),
    });

    if (!response.ok) {
      console.warn("Failed to resolve trust metrics", response.status);
      return [];
    }

    const payload = (await response.json()) as { metrics?: TrustMetricResolution[] };
    return payload.metrics ?? [];
  } catch (error) {
    console.warn("Error resolving trust metrics", error);
    return [];
  }
};

const resolveExperienceMetrics = async (experience: CheckoutTrustExperience): Promise<void> => {
  const { requests, registry } = buildMetricRequests(experience);
  if (requests.length === 0) {
    return;
  }

  const resolutions = await fetchTrustMetrics(experience.slug, requests);
  const resolutionMap = new Map(resolutions.map((resolution) => [resolution.metric_id, resolution]));

  registry.forEach((metrics, metricId) => {
    const resolution = resolutionMap.get(metricId);
    metrics.forEach((metric) => applyMetricResolution(metric, resolution));
  });

  experience.performanceSnapshots = experience.performanceSnapshots.map((snapshot) => {
    if (!snapshot.metric) {
      if (!snapshot.value && snapshot.fallbackValue) {
        snapshot.value = snapshot.fallbackValue;
      }
      return snapshot;
    }

    const resolution = resolutionMap.get(snapshot.metric.metricId);
    applyMetricResolution(snapshot.metric, resolution);

    if (resolution?.formatted_value) {
      snapshot.value = resolution.formatted_value;
    } else if (snapshot.fallbackValue) {
      snapshot.value = snapshot.fallbackValue;
    }

    return snapshot;
  });
};

const mergeWithFallback = (
  experience: CheckoutTrustExperience | null | undefined,
): CheckoutTrustExperience => {
  return cloneExperience({
    ...fallbackExperience,
    ...(experience ?? fallbackExperience),
    slug: experience?.slug ?? fallbackExperience.slug,
    assurances:
      (experience?.assurances?.length ?? 0) > 0
        ? experience!.assurances
        : fallbackExperience.assurances,
    supportChannels:
      (experience?.supportChannels?.length ?? 0) > 0
        ? experience!.supportChannels
        : fallbackExperience.supportChannels,
    performanceSnapshots:
      (experience?.performanceSnapshots?.length ?? 0) > 0
        ? experience!.performanceSnapshots
        : fallbackExperience.performanceSnapshots,
    testimonials:
      (experience?.testimonials?.length ?? 0) > 0
        ? experience!.testimonials
        : fallbackExperience.testimonials,
    bundleOffers:
      (experience?.bundleOffers?.length ?? 0) > 0
        ? experience!.bundleOffers
        : fallbackExperience.bundleOffers,
  });
};

export const getCheckoutTrustExperience = cache(async (): Promise<CheckoutTrustExperience> => {
  if (!isPayload()) {
    return cloneExperience(fallbackExperience);
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
    const combined = mergeWithFallback(experience);

    await resolveExperienceMetrics(combined);

    combined.assurances = combined.assurances.map((assurance) => ({
      ...assurance,
      metric: cloneMetric(assurance.metric),
    }));
    combined.performanceSnapshots = combined.performanceSnapshots.map((snapshot) => ({
      ...snapshot,
      metric: cloneMetric(snapshot.metric),
    }));

    return combined;
  } catch (error) {
    console.warn("Failed to fetch checkout trust experience from Payload", error);
    return cloneExperience(fallbackExperience);
  }
});

export async function getCheckoutTrustExperienceDraft(
  slug: string,
): Promise<CheckoutTrustExperience> {
  if (!isPayload()) {
    return cloneExperience(fallbackExperience);
  }

  try {
    const env = payloadConfig.environment;
    const data = await payloadGet<{ docs?: unknown[] }>({
      path: "/api/checkout-trust-experiences",
      query: {
        "where[slug][equals]": slug,
        "where[environment][equals]": env,
        draft: "true",
        limit: 1,
      },
    });

    const experience = normalizeCheckoutTrust(data.docs?.[0]);
    return mergeWithFallback(experience);
  } catch (error) {
    console.warn("Failed to fetch draft checkout trust experience from Payload", error);
    return cloneExperience(fallbackExperience);
  }
}
