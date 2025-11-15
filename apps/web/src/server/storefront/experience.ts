import "server-only";

import { resolveStorefrontExperience, type StorefrontExperience, type StorefrontProduct } from "@/data/storefront-experience";
import { fetchProductDetail, type ProductDetail } from "@/server/catalog/products";
import { getCheckoutTrustExperience, type CheckoutTrustExperience } from "@/server/cms/trust";
import type { PageDocument } from "@/server/cms/types";

const EXPERIENCE_CACHE_TTL_MS = 60_000;
const experienceCache = new Map<
  string,
  {
    expiresAt: number;
    value: StorefrontExperience;
  }
>();

const LOYALTY_POINTS_PER_DOLLAR = 0.25;
const MAX_PROGRESS_POINT = 6000;

const formatCurrency = (value: number, currency?: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `$${value.toLocaleString()}`;
  }
};

const deriveTrustSignal = (detail: ProductDetail | null, fallback: StorefrontProduct["trustSignal"]) => {
  if (!detail?.fulfillmentSummary?.delivery) {
    return fallback;
  }

  const delivery = detail.fulfillmentSummary.delivery;
  const average = delivery.averageDays ?? delivery.maxDays ?? delivery.minDays;
  const value =
    typeof average === "number"
      ? `${average.toFixed(1)} days`
      : delivery.headline ?? fallback.value;
  const label = delivery.headline ?? delivery.narrative ?? fallback.label;

  return {
    value,
    label
  };
};

const deriveJourneyInsight = (detail: ProductDetail | null, fallback: string) => {
  const delivery = detail?.fulfillmentSummary?.delivery;
  return delivery?.narrative ?? fallback;
};

const deriveSla = (detail: ProductDetail | null, fallback: string) => {
  const delivery = detail?.fulfillmentSummary?.delivery;
  return delivery?.headline ?? delivery?.narrative ?? fallback;
};

const deriveLoyaltyHint = (detail: ProductDetail | null, fallback: StorefrontProduct["loyaltyHint"]) => {
  const basePrice = detail?.basePrice ?? null;
  if (basePrice == null) {
    return fallback;
  }
  const estimate = Math.max(500, Math.round(basePrice * LOYALTY_POINTS_PER_DOLLAR));
  const progress = Math.min(1, estimate / MAX_PROGRESS_POINT);
  const reward =
    detail?.fulfillmentSummary?.assurances?.[0]?.label ??
    detail?.fulfillmentSummary?.assurances?.[0]?.description ??
    fallback.reward;
  return {
    value: `Earn ${estimate.toLocaleString()} pts`,
    reward,
    progress,
    pointsEstimate: estimate
  };
};

const mergeProductDetail = (fallback: StorefrontProduct, detail: ProductDetail | null): StorefrontProduct => {
  if (!detail) {
    return fallback;
  }

  return {
    ...fallback,
    name: detail.title ?? fallback.name,
    summary: detail.description ?? fallback.summary,
    category: detail.category ?? fallback.category,
    price: formatCurrency(detail.basePrice, detail.currency),
    eligibility: detail.channelEligibility.length ? detail.channelEligibility : fallback.eligibility,
    trustSignal: deriveTrustSignal(detail, fallback.trustSignal),
    journeyInsight: deriveJourneyInsight(detail, fallback.journeyInsight),
    loyaltyHint: deriveLoyaltyHint(detail, fallback.loyaltyHint),
    sla: deriveSla(detail, fallback.sla)
  };
};

const mapHeroHighlights = (
  trust: CheckoutTrustExperience,
  fallback: StorefrontExperience["hero"]["highlights"]
) => {
  if (!trust.performanceSnapshots.length) {
    return fallback;
  }

  const highlights = trust.performanceSnapshots.slice(0, fallback.length).map((snapshot, index) => ({
    id: snapshot.id ?? `hero-${index}`,
    label: snapshot.label ?? fallback[index]?.label ?? "Snapshot",
    value: snapshot.value ?? snapshot.fallbackValue ?? fallback[index]?.value ?? "—",
    description: snapshot.caption ?? fallback[index]?.description ?? ""
  }));

  return highlights;
};

const mapTrustMetrics = (
  trust: CheckoutTrustExperience,
  fallback: StorefrontExperience["trustMetrics"]
) => {
  if (!trust.performanceSnapshots.length) {
    return fallback;
  }

  return trust.performanceSnapshots.slice(0, fallback.length).map((snapshot, index) => {
    const fallbackMetric = fallback[index];
    const verification = snapshot.metric?.verificationState;
    const trendDirection =
      verification === "fresh"
        ? "up"
        : verification === "stale"
          ? "flat"
          : verification === "missing"
            ? "down"
            : "flat";

    return {
      id: snapshot.id ?? fallbackMetric?.id ?? `metric-${index}`,
      label: snapshot.label ?? fallbackMetric?.label ?? "Metric",
      value: snapshot.value ?? snapshot.fallbackValue ?? fallbackMetric?.value ?? "—",
      description: snapshot.caption ?? fallbackMetric?.description ?? "",
      trendLabel: snapshot.metric?.metricId ?? fallbackMetric?.trendLabel ?? "verification",
      trendValue: verification ?? fallbackMetric?.trendValue ?? "fresh",
      trendDirection: trendDirection ?? fallbackMetric?.trendDirection ?? "flat"
    };
  });
};

const mapTestimonials = (
  trust: CheckoutTrustExperience,
  fallback: StorefrontExperience["testimonials"]
) => {
  if (!trust.testimonials.length) {
    return fallback;
  }

  return trust.testimonials.slice(0, fallback.length).map((testimonial, index) => ({
    id: testimonial.id ?? fallback[index]?.id ?? `testimonial-${index}`,
    quote: testimonial.quote,
    author: testimonial.author,
    role: testimonial.role ?? fallback[index]?.role,
    metric: fallback[index]?.metric ?? ""
  }));
};

const mapRewards = (
  trust: CheckoutTrustExperience,
  fallback: StorefrontExperience["rewards"]
) => {
  if (!trust.bundleOffers.length) {
    return fallback;
  }

  const callouts = trust.bundleOffers.slice(0, fallback.callouts.length).map((offer, index) => ({
    id: offer.slug ?? offer.id ?? `bundle-${index}`,
    title: offer.title,
    description: offer.description,
    progress: fallback.callouts[index]?.progress ?? 0.4,
    rewardValue: offer.savings ?? fallback.callouts[index]?.rewardValue ?? "Bonus value",
    timeline: "Bundle ready"
  }));

  return {
    ...fallback,
    callouts
  };
};

export async function getStorefrontExperience(page?: PageDocument | null): Promise<StorefrontExperience> {
  const cacheKey = page?._id ?? "homepage";
  const cached = experienceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const baseExperience = resolveStorefrontExperience(page);
  const [trustExperience, productDetails] = await Promise.all([
    getCheckoutTrustExperience(),
    Promise.all(baseExperience.products.map((product) => fetchProductDetail(product.slug)))
  ]);

  const products = baseExperience.products.map((product, index) =>
    mergeProductDetail(product, productDetails[index])
  );

  const experience: StorefrontExperience = {
    ...baseExperience,
    hero: {
      ...baseExperience.hero,
      highlights: mapHeroHighlights(trustExperience, baseExperience.hero.highlights)
    },
    trustMetrics: mapTrustMetrics(trustExperience, baseExperience.trustMetrics),
    testimonials: mapTestimonials(trustExperience, baseExperience.testimonials),
    products,
    rewards: mapRewards(trustExperience, baseExperience.rewards)
  };

  experienceCache.set(cacheKey, {
    expiresAt: Date.now() + EXPERIENCE_CACHE_TTL_MS,
    value: experience
  });

  return experience;
}
