import "server-only";

import type {
  PricingExperiment,
  PricingExperimentMetric,
  PricingExperimentVariant,
} from "@/types/pricing-experiments";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey =
  process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

export type CreatePricingExperimentPayload = {
  slug: string;
  name: string;
  description?: string | null;
  targetProductSlug: string;
  targetSegment?: string | null;
  featureFlagKey?: string | null;
  assignmentStrategy: string;
  variants: Array<{
    key: string;
    name: string;
    description?: string | null;
    weight?: number;
    isControl?: boolean;
    adjustmentKind?: "delta" | "multiplier";
    priceDeltaCents?: number;
    priceMultiplier?: number | null;
  }>;
};

export type UpdatePricingExperimentPayload = {
  status?: string;
  targetSegment?: string | null;
  featureFlagKey?: string | null;
  assignmentStrategy?: string | null;
};

export type PricingExperimentEventPayload = {
  variantKey: string;
  exposures?: number;
  conversions?: number;
  revenueCents?: number;
  windowStart?: string | null;
};

async function requestPricingApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (!checkoutApiKey) {
    throw new Error("Missing checkout API key for pricing experiment calls");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": checkoutApiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Request to ${path} failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

const toExperiment = (payload: Record<string, any>): PricingExperiment => ({
  slug: payload.slug,
  name: payload.name,
  description: payload.description ?? null,
  status: payload.status,
  targetProductSlug: payload.target_product_slug ?? payload.targetProductSlug,
  targetSegment: payload.target_segment ?? payload.targetSegment ?? null,
  featureFlagKey: payload.feature_flag_key ?? payload.featureFlagKey ?? null,
  assignmentStrategy: payload.assignment_strategy ?? payload.assignmentStrategy,
  variants: Array.isArray(payload.variants)
    ? payload.variants.map((variant: Record<string, any>) => ({
        key: variant.key,
        name: variant.name,
        description: variant.description ?? null,
        weight: Number(variant.weight ?? 0),
        isControl: Boolean(variant.is_control ?? variant.isControl ?? false),
        adjustmentKind:
          (variant.adjustment_kind ?? variant.adjustmentKind ?? "delta") === "multiplier"
            ? "multiplier"
            : "delta",
        priceDeltaCents: Number(variant.price_delta_cents ?? variant.priceDeltaCents ?? 0),
        priceMultiplier:
          variant.price_multiplier ?? variant.priceMultiplier ?? null,
        metrics: Array.isArray(variant.metrics)
          ? variant.metrics.map((metric: Record<string, any>) => ({
              windowStart:
                typeof metric.window_start === "string"
                  ? metric.window_start
                  : typeof metric.windowStart === "string"
                    ? metric.windowStart
                    : null,
              exposures: Number(metric.exposures ?? 0),
              conversions: Number(metric.conversions ?? 0),
              revenueCents: Number(metric.revenue_cents ?? metric.revenueCents ?? 0),
            }))
          : [],
      }))
    : [],
  provenance: typeof payload.provenance === "object" && payload.provenance ? payload.provenance : {},
});

export async function fetchPricingExperiments(): Promise<PricingExperiment[]> {
  if (!checkoutApiKey) {
    return [];
  }

  const payload = await requestPricingApi<unknown[]>("/api/v1/catalog/pricing-experiments");
  return payload.map((entry) => toExperiment(entry as Record<string, any>));
}

export async function createPricingExperiment(
  payload: CreatePricingExperimentPayload,
): Promise<PricingExperiment> {
  const response = await requestPricingApi<Record<string, any>>("/api/v1/catalog/pricing-experiments", {
    method: "POST",
    body: JSON.stringify({
      slug: payload.slug,
      name: payload.name,
      description: payload.description ?? null,
      target_product_slug: payload.targetProductSlug,
      target_segment: payload.targetSegment ?? null,
      feature_flag_key: payload.featureFlagKey ?? null,
      assignment_strategy: payload.assignmentStrategy,
      variants: payload.variants.map((variant) => ({
        key: variant.key,
        name: variant.name,
        description: variant.description ?? null,
        weight: variant.weight ?? 0,
        is_control: variant.isControl ?? false,
        adjustment_kind: variant.adjustmentKind ?? "delta",
        price_delta_cents: variant.priceDeltaCents ?? 0,
        price_multiplier: variant.priceMultiplier ?? null,
      })),
    }),
  });

  return toExperiment(response);
}

export async function updatePricingExperiment(
  slug: string,
  payload: UpdatePricingExperimentPayload,
): Promise<PricingExperiment> {
  const response = await requestPricingApi<Record<string, any>>(
    `/api/v1/catalog/pricing-experiments/${slug}`,
    {
      method: "PUT",
      body: JSON.stringify({
        status: payload.status,
        target_segment: payload.targetSegment,
        feature_flag_key: payload.featureFlagKey,
        assignment_strategy: payload.assignmentStrategy,
      }),
    },
  );

  return toExperiment(response);
}

export async function recordPricingExperimentEvent(
  slug: string,
  payload: PricingExperimentEventPayload,
): Promise<PricingExperiment> {
  const response = await requestPricingApi<Record<string, any>>(
    `/api/v1/catalog/pricing-experiments/${slug}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        variant_key: payload.variantKey,
        exposures: payload.exposures ?? 0,
        conversions: payload.conversions ?? 0,
        revenue_cents: payload.revenueCents ?? 0,
        window_start: payload.windowStart ?? null,
      }),
    },
  );

  return toExperiment(response);
}
