"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type {
  LoyaltyCheckoutIntent,
  LoyaltyMemberSummary,
  LoyaltyReward,
  LoyaltyTier
} from "@smplat/types";
import type { CheckoutMetricVerification, CheckoutTrustExperience } from "@/server/cms/trust";
import { cartTotalSelector, useCartStore } from "@/store/cart";
import { getStorefrontProductExperience } from "@/data/storefront-experience";
import { marketingFallbacks } from "../products/marketing-content";
import { AlertTriangle, BadgeCheck, Clock, ShieldCheck, Sparkles, Users } from "lucide-react";
import {
  clearResolvedIntents,
  queueCheckoutIntents,
  type CheckoutIntentDraft
} from "@/lib/loyalty/intents";
import type { PricingExperiment } from "@/types/pricing-experiments";
import { selectPricingExperimentVariant } from "@/lib/pricing-experiments";
import { logPricingExperimentEvents, type PricingExperimentEventInput } from "@/lib/pricing-experiment-events";
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

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

function formatPoints(points: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(points);
}

const formatCheckoutExperimentAdjustment = (
  variant: PricingExperiment["variants"][number],
  currency: string
): string => {
  if (variant.adjustmentKind === "multiplier") {
    if (typeof variant.priceMultiplier === "number" && Number.isFinite(variant.priceMultiplier)) {
      return `${variant.priceMultiplier.toFixed(2)}×`;
    }
    return "Multiplier TBD";
  }
  if (variant.priceDeltaCents === 0) {
    return "No change";
  }
  const dollars = variant.priceDeltaCents / 100;
  const formatted = formatCurrency(Math.abs(dollars), currency);
  return variant.priceDeltaCents > 0 ? `+${formatted}` : `-${formatted}`;
};

type CheckoutState = {
  fullName: string;
  email: string;
  company?: string;
  notes?: string;
};

type CheckoutPageClientProps = {
  trustContent: CheckoutTrustExperience;
  loyaltyMember: LoyaltyMemberSummary | null;
  loyaltyRewards: LoyaltyReward[];
  pricingExperiments: PricingExperiment[];
};

type AssuranceDisplay = {
  id: string;
  title: string;
  description: string;
  evidence?: string;
  metric?: CheckoutMetricVerification;
};

type UpsellRecommendation = {
  id: string;
  slug: string;
  title: string;
  description: string;
  savings?: string;
  href: string;
};

function metricTooltip(metric: CheckoutMetricVerification): string {
  const segments: string[] = [`Metric: ${metric.metricId}`];
  if (metric.source) {
    segments.push(`Source: ${metric.source}`);
  }
  if (metric.sampleSize && metric.sampleSize > 0) {
    segments.push(`Sample size: ${metric.sampleSize}`);
  }
  if (metric.computedAt) {
    const parsed = new Date(metric.computedAt);
    if (!Number.isNaN(parsed.getTime())) {
      segments.push(`Computed: ${parsed.toLocaleString("en-US", { timeZone: "UTC" })}`);
    }
  }
  if (metric.provenanceNote) {
    segments.push(metric.provenanceNote);
  }
  if (metric.verificationState === "preview") {
    segments.push("Operator preview value");
  }
  const alerts = metric.alerts?.filter((code): code is string => typeof code === "string");
  if (alerts && alerts.length > 0) {
    alerts.forEach((code) => {
      const description = alertDescriptions[code] ?? `Alert: ${code}`;
      segments.push(description);
    });
  }
  if (metric.fallbackCopy) {
    segments.push(metric.fallbackCopy);
  }
  return segments.join(" • ");
}

function metricBadgeTone(metric: CheckoutMetricVerification): string {
  switch (metric.verificationState) {
    case "fresh":
    case "preview":
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "stale":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    case "missing":
    case "unsupported":
      return "border-red-400/40 bg-red-500/10 text-red-100";
    default:
      return "border-white/20 bg-white/10 text-white/80";
  }
}

function metricBadgeLabel(metric: CheckoutMetricVerification): string {
  switch (metric.verificationState) {
    case "fresh":
      return "Verified";
    case "preview":
      return "Preview";
    case "stale":
      return "Stale";
    case "missing":
    case "unsupported":
      return "Unavailable";
    default:
      return "Metric";
  }
}

function metricNote(metric?: CheckoutMetricVerification): string | null {
  if (!metric) {
    return null;
  }

  const alertMessage = metric.alerts?.map((code) => alertDescriptions[code] ?? null).find((message) => message) ?? null;
  const guardMessage = metric.fallbackCopy
    ?? (metric.unsupportedGuard ? unsupportedGuardNarratives[metric.unsupportedGuard] ?? null : null);

  switch (metric.verificationState) {
    case "fresh":
      return metric.provenanceNote ?? guardMessage ?? alertMessage ?? null;
    case "preview":
      return metric.provenanceNote
        ? `${metric.provenanceNote} • Preview data`
        : "Preview data supplied by operators.";
    case "stale":
      if (metric.provenanceNote) {
        return alertMessage ? `${metric.provenanceNote} • ${alertMessage}` : metric.provenanceNote;
      }
      return alertMessage ?? "Refresh scheduled – showing last computed value.";
    case "missing":
    case "unsupported":
      return guardMessage ?? alertMessage ?? "Live metric unavailable – showing fallback narrative.";
    default:
      return metric.provenanceNote ?? guardMessage ?? alertMessage ?? null;
  }
}

function MetricBadge({ metric }: { metric?: CheckoutMetricVerification }) {
  if (!metric) {
    return null;
  }

  const tooltip = metricTooltip(metric);
  const label = metricBadgeLabel(metric);
  const tone = metricBadgeTone(metric);
  const Icon =
    metric.verificationState === "fresh" || metric.verificationState === "preview"
      ? BadgeCheck
      : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export function CheckoutPageClient({
  trustContent,
  loyaltyMember,
  loyaltyRewards,
  pricingExperiments,
}: CheckoutPageClientProps) {
  const items = useCartStore((state) => state.items);
  const cartTotal = useCartStore(cartTotalSelector);
  const clearCart = useCartStore((state) => state.clear);

  const [formState, setFormState] = useState<CheckoutState>({
    fullName: "",
    email: "",
    company: "",
    notes: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loyaltyTiers, setLoyaltyTiers] = useState<LoyaltyTier[]>([]);
  const [loyaltyStatus, setLoyaltyStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [plannedRewardSlug, setPlannedRewardSlug] = useState<string | null>(null);
  const [planReferralFollowUp, setPlanReferralFollowUp] = useState(false);
  const [intentNotice, setIntentNotice] = useState<string | null>(null);

  const currency = items[0]?.currency ?? "USD";

  const disabled = items.length === 0 || !formState.fullName || !formState.email;

  const loyaltyRewardOptions = useMemo(
    () =>
      (loyaltyRewards ?? [])
        .filter((reward) => reward.isActive)
        .sort((a, b) => a.costPoints - b.costPoints)
        .slice(0, 3),
    [loyaltyRewards]
  );

  const selectedReward = useMemo(
    () => loyaltyRewardOptions.find((reward) => reward.slug === plannedRewardSlug) ?? null,
    [loyaltyRewardOptions, plannedRewardSlug]
  );

  const orderSummary = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.unitPrice * item.quantity
      })),
    [items]
  );

  const orderExperienceSummary = useMemo(() => {
    const entries: Array<{
      id: string;
      title: string;
      quantity: number;
      trustValue: string;
      trustLabel: string;
      loyaltyValue: string;
      loyaltyReward: string;
    }> = [];
    let projectedPoints = 0;
    const snapshot: Array<{
      productId: string;
      slug: string;
      quantity: number;
      trustSignal?: { value: string; label: string } | null;
      loyaltyHint?: { value: string; reward: string; pointsEstimate?: number; progress: number } | null;
      journeyInsight?: string | null;
      highlights?: string[];
      sla?: string | null;
      pointsTotal?: number;
    }> = [];

    items.forEach((item) => {
      const experience = item.experience ?? getStorefrontProductExperience(item.slug);
      if (!experience) {
        return;
      }
      if (experience.loyaltyHint.pointsEstimate != null) {
        projectedPoints += experience.loyaltyHint.pointsEstimate * item.quantity;
      }
      entries.push({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        trustValue: experience.trustSignal.value,
        trustLabel: experience.trustSignal.label,
        loyaltyValue: experience.loyaltyHint.value,
        loyaltyReward: experience.loyaltyHint.reward
      });
      snapshot.push({
        productId: item.productId,
        slug: item.slug,
        quantity: item.quantity,
        trustSignal: experience.trustSignal,
        loyaltyHint: experience.loyaltyHint,
        journeyInsight: experience.journeyInsight,
        highlights: experience.highlights.map((highlight) => highlight.label),
        sla: experience.sla,
        pointsTotal:
          experience.loyaltyHint.pointsEstimate != null
            ? experience.loyaltyHint.pointsEstimate * item.quantity
            : undefined
      });
    });

    return {
      entries,
      projectedPoints,
      snapshot
    };
  }, [items]);
  const orderExperiences = orderExperienceSummary.entries;
  const projectedLoyaltyPoints = orderExperienceSummary.projectedPoints;
  const journeyCartSnapshot = orderExperienceSummary.snapshot;
  const cartPricingExperiments = useMemo(() => {
    const experimentsBySlug = new Map<string, PricingExperiment>();
    pricingExperiments.forEach((experiment) => {
      const key = experiment.targetProductSlug?.toLowerCase();
      if (key) {
        experimentsBySlug.set(key, experiment);
      }
    });
    const seen = new Set<string>();
    return items
      .map((item) => {
        const key = item.slug.toLowerCase();
        const experiment = experimentsBySlug.get(key);
        if (!experiment || seen.has(experiment.slug)) {
          return null;
        }
        seen.add(experiment.slug);
        return {
          experiment,
          productTitle: item.title,
          slug: item.slug,
          quantity: item.quantity,
          lineTotalCents: Math.round(item.unitPrice * item.quantity * 100),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          experiment: PricingExperiment;
          productTitle: string;
          slug: string;
          quantity: number;
          lineTotalCents: number;
        } => Boolean(entry),
      );
  }, [items, pricingExperiments]);

  const pricingExperimentContext = useMemo(
    () =>
      cartPricingExperiments.map(({ experiment, slug, lineTotalCents, quantity }) => {
        const assignedVariant = selectPricingExperimentVariant(experiment);
        return {
          slug: experiment.slug,
          status: experiment.status,
          assignmentStrategy: experiment.assignmentStrategy,
          targetProductSlug: experiment.targetProductSlug,
          featureFlagKey: experiment.featureFlagKey,
          sourceProductSlug: slug,
          assignedVariantKey: assignedVariant?.key ?? null,
          lineTotalCents,
          quantity,
          variants: experiment.variants.map((variant) => ({
            key: variant.key,
            isControl: variant.isControl,
            adjustmentKind: variant.adjustmentKind,
            priceDeltaCents: variant.priceDeltaCents,
            priceMultiplier: variant.priceMultiplier,
          })),
        };
      }),
    [cartPricingExperiments]
  );

  const logCheckoutPricingExperimentConversions = useCallback(async () => {
    if (cartPricingExperiments.length === 0) {
      return;
    }
    const events: PricingExperimentEventInput[] = [];
    cartPricingExperiments.forEach(({ experiment, lineTotalCents, quantity }) => {
      const variant = selectPricingExperimentVariant(experiment);
      if (!variant) {
        return;
      }
      events.push({
        slug: experiment.slug,
        variantKey: variant.key,
        conversions: quantity,
        revenueCents: lineTotalCents,
      });
    });
    if (events.length === 0) {
      return;
    }
    await logPricingExperimentEvents(events);
  }, [cartPricingExperiments]);

  // meta: trust-module: checkout-assurances
  const aggregatedAssurances = useMemo<AssuranceDisplay[]>(() => {
    const map = new Map<string, AssuranceDisplay>();

    trustContent.assurances.forEach((assurance) => {
      const title = assurance.title.trim();
      if (!title) {
        return;
      }
      map.set(assurance.id, {
        id: assurance.id,
        title,
        description: assurance.description.trim(),
        evidence: assurance.evidence,
        metric: assurance.metric,
      });
    });

    items.forEach((item) => {
      (item.assuranceHighlights ?? []).forEach((highlight) => {
        const title = (highlight.label ?? "").trim();
        const description = (highlight.description ?? "").trim();
        if (!title && !description) {
          return;
        }
        const id = highlight.id ?? `${title}-${description}`;
        map.set(id, {
          id,
          title: title || description,
          description,
          evidence: (highlight.evidence as string | undefined) ?? undefined,
        });
      });
    });

    return Array.from(map.values()).slice(0, 4);
  }, [items, trustContent.assurances]);

  // meta: trust-module: checkout-support
  const aggregatedSupportChannels = useMemo(() => {
    const map = new Map<string, CheckoutTrustExperience["supportChannels"][number]>();

    trustContent.supportChannels.forEach((channel) => {
      map.set(channel.id, channel);
    });

    items.forEach((item) => {
      (item.supportChannels ?? []).forEach((channel) => {
        const id = `${channel.channel}:${channel.target}`;
        if (map.has(id)) {
          return;
        }
        map.set(id, {
          id,
          channel: channel.channel,
          label: channel.label,
          target: channel.target,
          availability: channel.availability ?? undefined,
        });
      });
    });

    return Array.from(map.values()).slice(0, 4);
  }, [items, trustContent.supportChannels]);

  // meta: trust-module: checkout-timeline
  const aggregatedTimeline = useMemo(() => {
    const estimates = items
      .map((item) => item.deliveryEstimate)
      .filter((estimate): estimate is NonNullable<typeof estimate> => Boolean(estimate));

    let fallbackMinDays: number | undefined;
    let fallbackMaxDays: number | undefined;
    let fallbackAverageSum = 0;
    let fallbackAverageCount = 0;
    let fallbackConfidence: string | undefined;
    const narrativeSegments = new Set<string>();

    if (trustContent.guaranteeDescription) {
      narrativeSegments.add(trustContent.guaranteeDescription);
    }

    estimates.forEach((estimate) => {
      if (typeof estimate.minDays === "number") {
        fallbackMinDays =
          typeof fallbackMinDays === "number"
            ? Math.min(fallbackMinDays, estimate.minDays)
            : estimate.minDays;
      }
      if (typeof estimate.maxDays === "number") {
        fallbackMaxDays =
          typeof fallbackMaxDays === "number"
            ? Math.max(fallbackMaxDays, estimate.maxDays)
            : estimate.maxDays;
      }
      if (typeof estimate.averageDays === "number") {
        fallbackAverageSum += estimate.averageDays;
        fallbackAverageCount += 1;
      }
      if (!fallbackConfidence && estimate.confidence) {
        fallbackConfidence = estimate.confidence;
      }
      if (estimate.narrative) {
        narrativeSegments.add(estimate.narrative);
      } else if (estimate.headline) {
        narrativeSegments.add(estimate.headline);
      }
    });

    const convertMinutesToDays = (minutes: number | null | undefined, mode: "ceil" | "round" = "round") => {
      if (typeof minutes !== "number" || Number.isNaN(minutes)) {
        return null;
      }
      const days = minutes / (60 * 24);
      const normalized = mode === "ceil" ? Math.ceil(days) : Math.round(days);
      return Math.max(1, normalized);
    };

    const deliveryTimeline = trustContent.deliveryTimeline;
    const resolvedTimeline = deliveryTimeline.resolved;

    const minDays =
      convertMinutesToDays(resolvedTimeline?.minMinutes, "round") ??
      (typeof fallbackMinDays === "number" ? fallbackMinDays : convertMinutesToDays(deliveryTimeline.fallbackMinMinutes, "round")) ??
      10;
    const maxDays =
      convertMinutesToDays(resolvedTimeline?.maxMinutes ?? resolvedTimeline?.p90Minutes, "ceil") ??
      (typeof fallbackMaxDays === "number" ? fallbackMaxDays : convertMinutesToDays(deliveryTimeline.fallbackMaxMinutes, "ceil")) ??
      14;

    let averageDays =
      convertMinutesToDays(resolvedTimeline?.averageMinutes ?? resolvedTimeline?.p50Minutes, "round") ??
      (fallbackAverageCount > 0 ? Math.round(fallbackAverageSum / fallbackAverageCount) : undefined) ??
      convertMinutesToDays(deliveryTimeline.fallbackAverageMinutes, "round") ??
      (typeof fallbackMinDays === "number" && typeof fallbackMaxDays === "number"
        ? Math.round((fallbackMinDays + fallbackMaxDays) / 2)
        : undefined);

    if (typeof averageDays !== "number") {
      averageDays = Math.round((minDays + maxDays) / 2);
    }

    const confidence =
      resolvedTimeline?.confidence ??
      deliveryTimeline.fallbackConfidence ??
      fallbackConfidence ??
      "Verified timeline";

    if (deliveryTimeline.narrative) {
      narrativeSegments.add(deliveryTimeline.narrative);
    }
    if (resolvedTimeline?.fallbackCopy) {
      narrativeSegments.add(resolvedTimeline.fallbackCopy);
    }
    if (resolvedTimeline?.alerts?.length) {
      resolvedTimeline.alerts
        .map((code) => alertDescriptions[code] ?? null)
        .filter((message): message is string => Boolean(message))
        .forEach((message) => narrativeSegments.add(message));
    }

    const narrative = Array.from(narrativeSegments).join(" ");

    return { minDays, maxDays, averageDays, confidence, narrative };
  }, [items, trustContent.deliveryTimeline, trustContent.guaranteeDescription]);

  // meta: trust-module: checkout-performance
  const performanceSnapshots = useMemo(
    () => trustContent.performanceSnapshots.slice(0, 3),
    [trustContent.performanceSnapshots]
  );
  const testimonialHighlight = trustContent.testimonials[0];

  const upsellRecommendations = useMemo<UpsellRecommendation[]>(() => {
    const cartSlugs = new Set(items.map((item) => item.slug));
    const seen = new Set<string>();
    const recommendations: UpsellRecommendation[] = [];

    const pushRecommendation = (bundle: { slug: string; title: string; description: string; savings?: string }) => {
      const normalizedSlug = bundle.slug.trim();
      if (!normalizedSlug || seen.has(normalizedSlug)) {
        return;
      }
      const parts = normalizedSlug.split("+");
      const target = parts.find((part) => !cartSlugs.has(part)) ?? parts[0];
      const href = `/products/${target}`;
      seen.add(normalizedSlug);
      recommendations.push({
        id: normalizedSlug,
        slug: normalizedSlug,
        title: bundle.title,
        description: bundle.description,
        savings: bundle.savings,
        href,
      });
    };

    trustContent.bundleOffers.forEach((bundle) => pushRecommendation(bundle));

    items.forEach((item) => {
      const fallback = marketingFallbacks[item.slug];
      fallback?.bundles?.forEach((bundle) => pushRecommendation(bundle));
    });

    return recommendations.slice(0, 4);
  }, [items, trustContent.bundleOffers]);

  const hasLoggedUpsellImpression = useRef(false);

  const recordOfferEvent = useCallback(
    async (eventType: string, recommendation: UpsellRecommendation) => {
      try {
        await fetch("/api/analytics/offer-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType,
            offerSlug: recommendation.slug,
            targetSlug: recommendation.slug,
            action: eventType === "cta_click" ? "cta_clicked" : "bundle_visible",
            cartTotal,
            currency,
          }),
        });
      } catch (trackingError) {
        console.warn("Failed to record offer event", trackingError);
      }
    },
    [cartTotal, currency]
  );

  useEffect(() => {
    if (!hasLoggedUpsellImpression.current && upsellRecommendations.length > 0) {
      void recordOfferEvent("impression", upsellRecommendations[0]);
      hasLoggedUpsellImpression.current = true;
    }
  }, [upsellRecommendations, recordOfferEvent]);

  useEffect(() => {
    if (plannedRewardSlug && !loyaltyRewardOptions.some((reward) => reward.slug === plannedRewardSlug)) {
      setPlannedRewardSlug(null);
    }
  }, [plannedRewardSlug, loyaltyRewardOptions]);

  useEffect(() => {
    if (!loyaltyMember?.referralCode && planReferralFollowUp) {
      setPlanReferralFollowUp(false);
    }
  }, [loyaltyMember?.referralCode, planReferralFollowUp]);

  useEffect(() => {
    let cancelled = false;
    const fetchTiers = async () => {
      setLoyaltyStatus("loading");
      try {
        const response = await fetch("/api/v1/loyalty/tiers");
        if (!response.ok) {
          throw new Error(`Failed to load loyalty tiers: ${response.status}`);
        }
        const tiers: LoyaltyTier[] = await response.json();
        if (!cancelled) {
          setLoyaltyTiers(tiers.slice(0, 3));
          setLoyaltyStatus("ready");
        }
      } catch (fetchError) {
        console.warn("Unable to load loyalty tiers", fetchError);
        if (!cancelled) {
          setLoyaltyStatus("error");
        }
      }
    };

    void fetchTiers();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (disabled) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    let queuedIntents: LoyaltyCheckoutIntent[] = [];
    try {
      try {
        await logCheckoutPricingExperimentConversions();
      } catch (experimentLogError) {
        console.warn("Failed to log pricing experiment conversions", experimentLogError);
      }

      if (plannedRewardSlug || (planReferralFollowUp && loyaltyMember?.referralCode)) {
        const intentsToPersist: CheckoutIntentDraft[] = [];
        if (selectedReward) {
          intentsToPersist.push({
            kind: "redemption",
            rewardSlug: selectedReward.slug,
            rewardName: selectedReward.name,
            pointsCost: selectedReward.costPoints,
            quantity: 1,
            metadata: {
              source: "checkout",
              tier: loyaltyMember?.currentTier ?? null
            }
          });
        }
        if (planReferralFollowUp && loyaltyMember?.referralCode) {
          intentsToPersist.push({
            kind: "referral_share",
            referralCode: loyaltyMember.referralCode,
            channel: "checkout",
            metadata: {
              source: "checkout",
              tier: loyaltyMember?.currentTier ?? null
            }
          });
        }

        if (intentsToPersist.length > 0) {
          queuedIntents = queueCheckoutIntents(intentsToPersist);
          if (queuedIntents.length > 0) {
            setIntentNotice("We\u2019ll remind you to follow through after payment.");
          }
        }
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "";

      const journeyCartWithPoints = journeyCartSnapshot.map((item) => ({
        ...item,
        loyaltyHint: item.loyaltyHint
          ? {
              ...item.loyaltyHint,
              pointsEstimate:
                typeof item.loyaltyHint.pointsEstimate === "number" ? item.loyaltyHint.pointsEstimate : null
            }
          : null,
        pointsTotal: typeof item.pointsTotal === "number" ? item.pointsTotal : null
      }));

      const journeyContext = {
        channel: "checkout",
        cart: journeyCartWithPoints,
        form: formState,
        loyalty: loyaltyMember
          ? {
              id: loyaltyMember.id,
              tier: loyaltyMember.currentTier,
              referralCode: loyaltyMember.referralCode ?? null,
              pointsBalance: loyaltyMember.pointsBalance,
              availablePoints: loyaltyMember.availablePoints,
            }
          : null,
        loyaltyProjection: {
          projectedPoints: projectedLoyaltyPoints
        },
        plannedRewardSlug: plannedRewardSlug ?? null,
        referralPlanEnabled: Boolean(planReferralFollowUp && loyaltyMember?.referralCode),
        intents: queuedIntents.map((intent) => ({
          id: intent.id,
          kind: intent.kind,
          rewardSlug: intent.rewardSlug ?? null,
          channel: intent.channel ?? null,
        })),
        rewards: loyaltyRewards.map((reward) => ({
          id: reward.id,
          slug: reward.slug,
          name: reward.name,
          costPoints: reward.costPoints,
        })),
        pricingExperiments: pricingExperimentContext,
      };

      const successUrl = new URL(`${origin}/checkout/success`);
      if (projectedLoyaltyPoints > 0) {
        successUrl.searchParams.set("projectedPoints", projectedLoyaltyPoints.toString());
      }

      const noteSegments = [
        `Customer: ${formState.fullName} (${formState.email})`,
        formState.company ? `Company: ${formState.company}` : null,
        formState.notes ? `Notes: ${formState.notes}` : null,
        projectedLoyaltyPoints > 0 ? `loyaltyProjection=${projectedLoyaltyPoints}` : null
      ].filter(Boolean);

      const payload = {
        order: {
          currency,
          source: "checkout",
          notes: noteSegments.join(" | "),
          loyalty_projection_points: projectedLoyaltyPoints > 0 ? projectedLoyaltyPoints : null,
          items: items.map((item) => ({
            product_id: item.productId,
            product_title: item.title,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.unitPrice * item.quantity,
            selected_options: {
              options: item.selectedOptions,
              addOns: item.addOns,
              subscriptionPlan: item.subscriptionPlan,
              presetId: item.presetId ?? null,
              presetLabel: item.presetLabel ?? null
            },
            attributes: {
              customFields: item.customFields
            }
          }))
        },
        payment: {
          customer_email: formState.email,
          success_url: successUrl.toString(),
          cancel_url: `${origin}/checkout`
        },
        journeyContext,
      };

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? "Checkout request failed");
      }

      const { payment, order } = await response.json();
      const checkoutUrl = payment.checkout_url;

      // Defer clearing the cart until success callback.
      window.location.href = `${checkoutUrl}`;
    } catch (err) {
      if (queuedIntents.length > 0) {
        clearResolvedIntents((intent) => queuedIntents.some((queued) => queued.id === intent.id));
      }
      const message = err instanceof Error ? err.message : "Unexpected checkout error";
      setError(message);
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-24 text-white">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center backdrop-blur">
          <h1 className="text-3xl font-semibold">Your cart is empty</h1>
          <p className="mt-4 text-white/70">Add a service configuration before checking out.</p>
          <div className="mt-8">
            <Link
              href="/products"
              className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Browse services
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        <p className="text-sm text-white/60">
          Confirm your contact details and finalize payment via our Stripe-hosted checkout.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        {/* meta: trust-module: checkout-guarantee */}
        <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">{trustContent.guaranteeHeadline}</h2>
              <p className="text-sm text-white/60">{trustContent.guaranteeDescription}</p>
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-white/70">
            {aggregatedAssurances.map((assurance) => (
              <li key={assurance.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-white">{assurance.title}</p>
                  <MetricBadge metric={assurance.metric} />
                </div>
                <p>{assurance.description}</p>
                {assurance.evidence ? (
                  <p className="text-xs text-white/50">Evidence: {assurance.evidence}</p>
                ) : null}
                {metricNote(assurance.metric) ? (
                  <p className="text-xs text-white/50">{metricNote(assurance.metric)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
        {/* meta: trust-module: checkout-timeline */}
        <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
              <Clock className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">Delivery timeline</h2>
              <p className="text-sm text-white/60">{aggregatedTimeline.confidence}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <dt className="text-xs uppercase tracking-wide text-white/50">Kickoff</dt>
              <dd className="text-xl font-semibold text-white">{aggregatedTimeline.minDays}d</dd>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <dt className="text-xs uppercase tracking-wide text-white/50">First milestone</dt>
              <dd className="text-xl font-semibold text-white">{aggregatedTimeline.averageDays}d</dd>
            </div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <dt className="text-xs uppercase tracking-wide text-white/50">Full activation</dt>
              <dd className="text-xl font-semibold text-white">{aggregatedTimeline.maxDays}d</dd>
            </div>
          </dl>
          {aggregatedTimeline.narrative ? (
            <p className="mt-4 text-sm text-white/70">{aggregatedTimeline.narrative}</p>
          ) : null}
        </article>
        {/* meta: trust-module: checkout-support */}
        <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
              <Users className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">Concierge support</h2>
              <p className="text-sm text-white/60">Direct operator access before and after checkout.</p>
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-white/70">
            {aggregatedSupportChannels.map((channel) => {
              const href = channel.channel === "email"
                ? `mailto:${channel.target}`
                : channel.channel === "phone" || channel.channel === "call"
                  ? (channel.target.startsWith('tel:') ? channel.target : `tel:${channel.target}`)
                  : channel.target.startsWith('http')
                    ? channel.target
                    : channel.target;
              return (
                <li key={channel.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-white">{channel.label}</span>
                    <a href={href} className="text-xs text-white/60 underline-offset-2 hover:underline">{channel.target}</a>
                    {channel.availability ? (
                      <span className="text-xs text-white/50">{channel.availability}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
        <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">Loyalty perks</h2>
              <p className="text-sm text-white/60">Earn tiered rewards by completing campaigns and referrals.</p>
              {projectedLoyaltyPoints > 0 ? (
                <p className="text-xs text-emerald-200">
                  This cart will earn approximately {formatPoints(projectedLoyaltyPoints)} pts.
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 text-sm text-white/70">
            {loyaltyStatus === "loading" ? (
              <p className="animate-pulse text-white/50">Loading tier highlights…</p>
            ) : loyaltyStatus === "error" ? (
              <p className="text-white/50">Loyalty program overview temporarily unavailable.</p>
            ) : loyaltyTiers.length > 0 ? (
              <ul className="space-y-3">
                {loyaltyTiers.map((tier) => {
                  const benefits = Array.isArray(tier.benefits)
                    ? tier.benefits
                        .map((benefit) =>
                          typeof benefit === "string" ? benefit : typeof benefit === "object" && benefit !== null ? JSON.stringify(benefit) : String(benefit)
                        )
                        .filter((benefit) => benefit.trim().length > 0)
                    : [];
                  const benefitPreview = benefits.slice(0, 2).join(" • ");

                  return (
                    <li key={tier.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-white">{tier.name}</p>
                        <span className="text-xs text-white/50">{formatPoints(tier.pointThreshold)} pts</span>
                      </div>
                      {tier.description ? (
                        <p className="mt-1 text-xs text-white/60">{tier.description}</p>
                      ) : null}
                      {benefitPreview ? (
                        <p className="mt-2 text-xs text-white/50">{benefitPreview}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-white/50">Tiers unlock as soon as your first order is fulfilled.</p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-10 lg:grid-cols-[3fr,2fr]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div>
            <h2 className="text-xl font-semibold text-white">Contact details</h2>
            <p className="text-sm text-white/60">We use this information to send campaign updates and invoices.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-white/80">
              Full name
              <input
                type="text"
                value={formState.fullName}
                onChange={(event) => setFormState((prev) => ({ ...prev, fullName: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                required
                data-testid="name-input"
              />
            </label>
            <label className="space-y-2 text-sm text-white/80">
              Email
              <input
                type="email"
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                required
                data-testid="email-input"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-white/80">
              Company (optional)
              <input
                type="text"
                value={formState.company}
                onChange={(event) => setFormState((prev) => ({ ...prev, company: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                data-testid="company-input"
              />
            </label>
            <label className="space-y-2 text-sm text-white/80">
              Notes (optional)
              <input
                type="text"
                value={formState.notes}
                onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                placeholder="Any specifics for onboarding?"
              />
            </label>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSubmitting || disabled}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="submit-checkout"
            >
              {isSubmitting ? "Redirecting to Stripe…" : "Secure checkout"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearCart();
                setFormState({ fullName: "", email: "", company: "", notes: "" });
              }}
              className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
            >
              Clear cart
            </button>
          </div>
        </form>

        <aside className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold text-white">Order summary</h2>
            <p className="text-sm text-white/60">
              {items.length} {items.length === 1 ? "service" : "services"} configured
            </p>
          </div>
          <div className="space-y-4 text-sm text-white/70">
            {orderSummary.map((line) => (
              <div key={line.id} className="border-b border-white/10 pb-4">
                <p className="font-semibold text-white">{line.title}</p>
                <p>
                  {line.quantity} × {formatCurrency(line.unitPrice, currency)}
                </p>
                <p className="text-white/50">
                  Line total {formatCurrency(line.totalPrice, currency)}
                </p>
              </div>
            ))}
          </div>
          {cartPricingExperiments.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-xs text-amber-50">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Dynamic pricing trial</h3>
                <span className="rounded-full border border-amber-200/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-amber-100">
                  Beta
                </span>
              </div>
              {cartPricingExperiments.map(({ experiment, productTitle }) => (
                <div key={experiment.slug} className="rounded-xl border border-white/10 bg-black/20 p-3 text-white/80">
                  <p className="text-sm font-semibold text-white">{experiment.name}</p>
                  <p className="text-xs text-white/60">
                    Applied to {productTitle} · {experiment.assignmentStrategy}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-white/70">
                    {experiment.variants.map((variant) => (
                      <li key={`${experiment.slug}-${variant.key}`} className="flex items-center justify-between">
                        <span>
                          {variant.name}
                          {variant.isControl ? " · Control" : ""}
                        </span>
                        <span>{formatCheckoutExperimentAdjustment(variant, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-[11px] text-white/60">
                Variant telemetry syncs back to merchandising so future PDP and checkout pricing stays aligned.
              </p>
            </div>
          ) : null}
          {orderExperiences.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/70">
              <div className="flex items-center justify-between">
                <h3 className="uppercase tracking-wide text-white/50">Trust & loyalty</h3>
                {projectedLoyaltyPoints > 0 ? (
                  <span className="text-white/60">~{formatPoints(projectedLoyaltyPoints)} pts</span>
                ) : null}
              </div>
              <ul className="space-y-2">
                {orderExperiences.map((entry) => (
                  <li key={entry.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-sm font-semibold text-white">{entry.title}</p>
                    <p className="text-white/60">
                      {entry.trustValue} · {entry.trustLabel}
                    </p>
                    <p className="text-white/50">
                      {entry.loyaltyValue} · {entry.loyaltyReward}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-white/10 pt-4 text-sm">
            <span className="uppercase tracking-wide text-white/40">Subtotal</span>
            <span className="text-xl font-semibold text-white">{formatCurrency(cartTotal, currency)}</span>
          </div>
          <p className="text-xs text-white/60">
            Payments are processed securely via Stripe. You&apos;ll be redirected to confirm card details. On success
            we&apos;ll follow up with onboarding steps and assign your fulfillment pod.
          </p>
          {loyaltyMember ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wide text-white/50">Loyalty momentum</h3>
                <span className="text-xs text-white/60">
                  Balance {formatPoints(loyaltyMember.availablePoints)} pts
                </span>
              </div>
              <p className="text-xs text-white/60">
                Queue a post-purchase action so the loyalty hub can keep you on track after payment.
              </p>
              {loyaltyRewardOptions.length > 0 ? (
                <div className="space-y-2">
                  {loyaltyRewardOptions.map((reward) => {
                    const isSelected = plannedRewardSlug === reward.slug;
                    return (
                      <button
                        key={reward.id}
                        type="button"
                        onClick={() => setPlannedRewardSlug(isSelected ? null : reward.slug)}
                        data-testid={`plan-reward-${reward.slug}`}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                          isSelected
                            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                        }`}
                      >
                        <span className="block text-sm font-semibold text-white">{reward.name}</span>
                        <span className="block text-xs text-white/60">
                          {formatPoints(reward.costPoints)} pts · Quick redemption
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/60">
                  Browse the loyalty hub to pick your next redemption after payment.
                </p>
              )}
              <div className="flex items-start gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  id="loyalty-plan-referral"
                  className="mt-1 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-emerald-400 focus:ring-emerald-400"
                  checked={planReferralFollowUp && Boolean(loyaltyMember.referralCode)}
                  disabled={!loyaltyMember.referralCode}
                  onChange={(event) => setPlanReferralFollowUp(event.target.checked)}
                  data-testid="plan-referral-toggle"
                />
                <label htmlFor="loyalty-plan-referral" className="flex-1 cursor-pointer select-none">
                  {loyaltyMember.referralCode
                    ? `Remind me to follow up on referral code ${loyaltyMember.referralCode}.`
                    : "Generate a referral code in the loyalty hub to unlock share reminders."}
                </label>
              </div>
              {intentNotice ? <p className="text-[11px] text-emerald-200">{intentNotice}</p> : null}
            </div>
          ) : null}
          {performanceSnapshots.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <h3 className="text-xs uppercase tracking-wide text-white/50">Performance snapshots</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {performanceSnapshots.map((snapshot) => {
                  const note = metricNote(snapshot.metric);
                  return (
                    <div key={snapshot.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-white/50">{snapshot.label}</p>
                        <MetricBadge metric={snapshot.metric} />
                      </div>
                      <p className="text-lg font-semibold text-white">{snapshot.value}</p>
                      {snapshot.caption ? (
                        <p className="text-xs text-white/50">{snapshot.caption}</p>
                      ) : null}
                      {note ? <p className="text-xs text-white/50">{note}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {testimonialHighlight ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm italic text-white/80">&ldquo;{testimonialHighlight.quote}&rdquo;</p>
              <p className="mt-3 text-xs text-white/50">{testimonialHighlight.author}{testimonialHighlight.role ? ` · ${testimonialHighlight.role}` : ""}</p>
            </div>
          ) : null}
        </aside>
      </section>

      {upsellRecommendations.length > 0 ? (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Recommended bundles</h2>
              <p className="text-sm text-white/60">Contextual upsells tuned to your cart configuration.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {upsellRecommendations.map((recommendation) => (
              <div key={recommendation.id} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="space-y-2">
                  <p className="text-base font-semibold text-white">{recommendation.title}</p>
                  <p className="text-sm text-white/70">{recommendation.description}</p>
                  {recommendation.savings ? (
                    <span className="inline-flex w-fit items-center rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100">
                      {recommendation.savings}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Link
                    href={recommendation.href}
                    onClick={() => void recordOfferEvent("cta_click", recommendation)}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
                  >
                    Review bundle
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
