import type { PricingExperiment, PricingExperimentVariant } from "@/types/pricing-experiments";
import { isFeatureFlagEnabled } from "./feature-flags";

const CUSTOMER_VISIBLE_STATUSES = new Set(["running", "paused"]);

export function isPricingExperimentEnabled(experiment: PricingExperiment): boolean {
  return (
    CUSTOMER_VISIBLE_STATUSES.has(experiment.status.toLowerCase()) &&
    isFeatureFlagEnabled(experiment.featureFlagKey)
  );
}

export function isPricingExperimentCopyEnabled(
  status: string | null | undefined,
  featureFlagKey: string | null | undefined
): boolean {
  if (!status) {
    return false;
  }
  return CUSTOMER_VISIBLE_STATUSES.has(status.toLowerCase()) && isFeatureFlagEnabled(featureFlagKey);
}

export function filterEnabledPricingExperiments(
  experiments: PricingExperiment[],
): PricingExperiment[] {
  return experiments.filter((experiment) => isPricingExperimentEnabled(experiment));
}

export function selectExperimentsForProduct(
  experiments: PricingExperiment[],
  productSlug: string,
): PricingExperiment[] {
  return experiments.filter(
    (experiment) =>
      experiment.targetProductSlug?.toLowerCase() === productSlug.toLowerCase() &&
      isPricingExperimentEnabled(experiment),
  );
}

export function selectPricingExperimentVariant(
  experiment: PricingExperiment,
): PricingExperimentVariant | null {
  if (!experiment.variants.length) {
    return null;
  }

  const normalizedStrategy = experiment.assignmentStrategy?.toLowerCase() ?? "";
  const preferControl =
    normalizedStrategy.includes("control") || experiment.variants.every((variant) => variant.isControl);

  if (preferControl) {
    return experiment.variants.find((variant) => variant.isControl) ?? experiment.variants[0];
  }

  return experiment.variants.find((variant) => !variant.isControl) ?? experiment.variants[0];
}
