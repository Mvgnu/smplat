import { cache } from "react";
import "server-only";

import { z } from "zod";

import { isPayload, payloadConfig, payloadGet } from "./client";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const metricPreviewStates = ["fresh", "stale", "missing"] as const;
type MetricPreviewState = (typeof metricPreviewStates)[number];

const alertDescriptions: Record<string, string> = {
  sla_breach_risk: "Projected clearance exceeds the guaranteed delivery SLA.",
  sla_watch: "Operators are tracking elevated backlog depth.",
  limited_history: "Forecast is calibrating from a limited completion sample.",
  forecast_unavailable: "Forecast temporarily offline – showing fallback narrative.",
  no_staffing_capacity: "No upcoming staffing capacity windows are scheduled.",
  partial_support: "Only a subset of SKUs currently have staffed coverage.",
};

const unsupportedGuardNarratives: Record<string, string> = {
  all_skus_unsupported:
    "All staffing pods are offline for this bundle – concierge is reinforcing guarantee messaging.",
  partial_sku_support:
    "Some bundles are temporarily unsupported – fallback assurances highlighted for impacted SKUs.",
};

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
  metadata?: Record<string, unknown> | null;
  percentileBands?: Record<string, number | null> | null;
  freshnessMinutesElapsed?: number | null;
  unsupportedGuard?: string | null;
  forecast?: CheckoutMetricForecast | null;
  alerts?: string[] | null;
  fallbackCopy?: string | null;
};

export type CheckoutMetricForecastWindow = {
  start: string;
  end: string;
  hourlyCapacity: number;
  capacityTasks: number;
  backlogAtStart: number;
  projectedTasksCompleted: number;
  backlogAfter: number;
};

export type CheckoutMetricSkuForecast = {
  sku: string;
  backlogTasks: number;
  completedSampleSize: number;
  averageMinutes: number | null;
  percentileBands: Record<string, number | null>;
  windows: CheckoutMetricForecastWindow[];
  estimatedClearMinutes: number | null;
  unsupportedReason: string | null;
};

export type CheckoutMetricForecast = {
  generatedAt: string;
  horizonHours: number;
  skus: CheckoutMetricSkuForecast[];
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
      metric: {
        metricId: "fulfillment_backlog_minutes",
        metricSource: "fulfillment",
        freshnessWindowMinutes: 120,
        provenanceNote: "Live backlog minutes pulled from operator queues.",
      },
    },
    {
      id: "compliance",
      title: "Compliance-ready workflows",
      description:
        "Meta, TikTok, and FTC guardrails are embedded into each workflow with automated checks before campaigns go live.",
    },
    {
      id: "staffing",
      title: "Operators staffed ahead of demand",
      description:
        "Coverage planning blends live order intake with operator rosters so no campaign waits for assignments.",
      metric: {
        metricId: "fulfillment_staffing_coverage_pct",
        metricSource: "fulfillment",
        freshnessWindowMinutes: 180,
        provenanceNote: "24h staffing coverage trend across pods.",
      },
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
    {
      id: "backlog",
      label: "Active backlog",
      value: "Under 2h",
      fallbackValue: "Under 2h",
      caption: "Rolling average queue depth across pods",
      metric: {
        metricId: "fulfillment_backlog_minutes",
        metricSource: "fulfillment",
        freshnessWindowMinutes: 120,
        provenanceNote: "Operators keep backlog under two hours.",
      },
    },
    {
      id: "coverage",
      label: "Staffing coverage",
      value: "96%",
      fallbackValue: "96%",
      caption: "Completed vs. scheduled work (24h)",
      metric: {
        metricId: "fulfillment_staffing_coverage_pct",
        metricSource: "fulfillment",
        freshnessWindowMinutes: 180,
        provenanceNote: "Coverage stays above 90% on live queues.",
      },
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
  percentile_bands?: Record<string, number | null> | null;
  freshness_minutes_elapsed?: number | null;
  unsupported_guard?: string | null;
  forecast?: unknown;
  alerts?: string[] | null;
  fallback_copy?: string | null;
};

type TrustMetricRequestPayload = {
  metric_id: string;
  freshness_window_minutes?: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toIntWithFallback = (value: unknown, fallback = 0): number => {
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return fallback;
  }
  const truncated = Math.trunc(parsed);
  return Number.isFinite(truncated) ? truncated : fallback;
};

const normalizeForecast = (forecast: unknown): CheckoutMetricForecast | null => {
  if (!isRecord(forecast)) {
    return null;
  }

  const generatedAt =
    typeof forecast.generated_at === "string"
      ? forecast.generated_at
      : typeof forecast.generatedAt === "string"
        ? forecast.generatedAt
        : null;
  const horizonHoursNumber =
    toNumberOrNull(forecast.horizon_hours) ?? toNumberOrNull(forecast.horizonHours);

  const skuEntries = Array.isArray(forecast.skus) ? forecast.skus : [];
  const skus: CheckoutMetricSkuForecast[] = skuEntries
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const windowsRaw = Array.isArray(entry.windows) ? entry.windows : [];
      const windows = windowsRaw
        .map((windowEntry) => {
          if (!isRecord(windowEntry)) {
            return null;
          }

          const start =
            typeof windowEntry.start === "string"
              ? windowEntry.start
              : typeof windowEntry.starts_at === "string"
                ? windowEntry.starts_at
                : null;
          const end =
            typeof windowEntry.end === "string"
              ? windowEntry.end
              : typeof windowEntry.ends_at === "string"
                ? windowEntry.ends_at
                : null;
          if (!start || !end) {
            return null;
          }

          return {
            start,
            end,
            hourlyCapacity: toIntWithFallback(windowEntry.hourly_capacity ?? windowEntry.hourlyCapacity),
            capacityTasks: toIntWithFallback(windowEntry.capacity_tasks ?? windowEntry.capacityTasks),
            backlogAtStart: toIntWithFallback(windowEntry.backlog_at_start ?? windowEntry.backlogAtStart),
            projectedTasksCompleted: toIntWithFallback(
              windowEntry.projected_tasks_completed ?? windowEntry.projectedTasksCompleted,
            ),
            backlogAfter: toIntWithFallback(windowEntry.backlog_after ?? windowEntry.backlogAfter),
          } satisfies CheckoutMetricForecastWindow;
        })
        .filter(Boolean) as CheckoutMetricForecastWindow[];

      const percentileBands = isRecord(entry.percentile_bands ?? entry.percentileBands)
        ? Object.entries((entry.percentile_bands ?? entry.percentileBands) as Record<string, unknown>).reduce(
            (acc, [key, val]) => {
              acc[key] = toNumberOrNull(val);
              return acc;
            },
            {} as Record<string, number | null>,
          )
        : {};

      return {
        sku: typeof entry.sku === "string" ? entry.sku : "unknown-sku",
        backlogTasks: toIntWithFallback(entry.backlog_tasks ?? entry.backlogTasks),
        completedSampleSize: toIntWithFallback(
          entry.completed_sample_size ?? entry.completedSampleSize,
        ),
        averageMinutes: toNumberOrNull(entry.average_minutes ?? entry.averageMinutes),
        percentileBands,
        windows,
        estimatedClearMinutes: toNumberOrNull(
          entry.estimated_clear_minutes ?? entry.estimatedClearMinutes,
        ),
        unsupportedReason:
          typeof entry.unsupported_reason === "string"
            ? entry.unsupported_reason
            : typeof entry.unsupportedReason === "string"
              ? entry.unsupportedReason
              : null,
      } satisfies CheckoutMetricSkuForecast;
    })
    .filter(Boolean) as CheckoutMetricSkuForecast[];

  if (!generatedAt || horizonHoursNumber === null) {
    return null;
  }

  return {
    generatedAt,
    horizonHours: Math.trunc(horizonHoursNumber),
    skus,
  } satisfies CheckoutMetricForecast;
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
    metadata: metric.metadata ? { ...metric.metadata } : null,
    percentileBands: metric.percentileBands ? { ...metric.percentileBands } : null,
    freshnessMinutesElapsed: metric.freshnessMinutesElapsed ?? null,
    unsupportedGuard: metric.unsupportedGuard ?? null,
    forecast: metric.forecast
      ? {
          generatedAt: metric.forecast.generatedAt,
          horizonHours: metric.forecast.horizonHours,
          skus: metric.forecast.skus.map((sku) => ({
            ...sku,
            percentileBands: { ...sku.percentileBands },
            windows: sku.windows.map((window) => ({ ...window })),
          })),
        }
      : null,
    alerts: metric.alerts ? [...metric.alerts] : null,
    fallbackCopy: metric.fallbackCopy ?? null,
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
    metadata: null,
    percentileBands: null,
    freshnessMinutesElapsed: null,
    unsupportedGuard: null,
    forecast: null,
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
    metric.metadata = metric.metadata ?? null;
    metric.percentileBands = metric.percentileBands ?? null;
    metric.freshnessMinutesElapsed = metric.freshnessMinutesElapsed ?? null;
    metric.unsupportedGuard = metric.unsupportedGuard ?? null;
    metric.forecast = metric.forecast ?? null;
    metric.alerts = metric.alerts ?? null;
    metric.fallbackCopy = metric.fallbackCopy ?? null;
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
  metric.percentileBands =
    resolution.percentile_bands && isRecord(resolution.percentile_bands)
      ? Object.entries(resolution.percentile_bands).reduce((acc, [key, val]) => {
          acc[key] = toNumberOrNull(val);
          return acc;
        }, {} as Record<string, number | null>)
      : resolution.percentile_bands ?? null;
  metric.freshnessMinutesElapsed = toNumberOrNull(resolution.freshness_minutes_elapsed);
  metric.unsupportedGuard =
    typeof resolution.unsupported_guard === "string" ? resolution.unsupported_guard : null;
  metric.forecast = normalizeForecast(resolution.forecast ?? null);
  const alertList = Array.isArray(resolution.alerts)
    ? resolution.alerts
    : Array.isArray((resolution as Record<string, unknown>).alerts)
      ? ((resolution as Record<string, unknown>).alerts as unknown[])
      : [];
  metric.alerts = alertList
    .map((code) => (typeof code === "string" ? code : null))
    .filter((code): code is string => Boolean(code && code.trim().length > 0));
  if (metric.alerts.length === 0) {
    metric.alerts = null;
  }

  const fallbackCopyRaw =
    typeof resolution.fallback_copy === "string"
      ? resolution.fallback_copy
      : typeof (resolution as Record<string, unknown>).fallbackCopy === "string"
        ? ((resolution as Record<string, unknown>).fallbackCopy as string)
        : null;
  metric.fallbackCopy = fallbackCopyRaw ?? null;

  const provenanceNotes = provenance?.notes ?? null;
  metric.provenanceNotes = provenanceNotes && provenanceNotes.length > 0 ? [...provenanceNotes] : null;
  metric.metadata = resolution.metadata ?? null;

  if (metric.provenanceNotes?.length) {
    metric.provenanceNote = metric.provenanceNotes[0];
  }
  if (metric.fallbackCopy) {
    metric.provenanceNote = metric.provenanceNote ?? metric.fallbackCopy;
    const existing = new Set(metric.provenanceNotes ?? []);
    existing.add(metric.fallbackCopy);
    metric.provenanceNotes = [...existing];
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

    if (snapshot.metric?.fallbackCopy) {
      snapshot.caption = snapshot.metric.fallbackCopy;
    } else if (typeof resolution?.fallback_copy === "string" && !snapshot.caption) {
      snapshot.caption = resolution.fallback_copy;
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
