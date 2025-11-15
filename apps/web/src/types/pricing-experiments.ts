export type PricingExperimentMetric = {
  windowStart: string | null;
  exposures: number;
  conversions: number;
  revenueCents: number;
};

export type PricingExperimentVariant = {
  key: string;
  name: string;
  description: string | null;
  weight: number;
  isControl: boolean;
  adjustmentKind: "delta" | "multiplier";
  priceDeltaCents: number;
  priceMultiplier: number | null;
  metrics: PricingExperimentMetric[];
};

export type PricingExperiment = {
  slug: string;
  name: string;
  description: string | null;
  status: string;
  targetProductSlug: string;
  targetSegment: string | null;
  featureFlagKey: string | null;
  assignmentStrategy: string;
  variants: PricingExperimentVariant[];
  provenance: Record<string, unknown>;
};
