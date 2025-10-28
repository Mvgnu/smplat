import type {
  CatalogBundleRecommendation,
  CatalogExperimentResponse,
  CatalogExperimentVariant,
} from "@smplat/types";

export type BundleExperimentVariantOverlay = {
  experimentSlug: string;
  experimentName: string;
  status: string;
  variantKey: string;
  isControl: boolean;
  bundleSlug: string | null;
  guardrailBreached: boolean;
  latestAcceptanceRate: number | null;
  latestSampleSize: number | null;
};

function latestMetric(variant: CatalogExperimentVariant): CatalogExperimentVariant["metrics"][number] | null {
  if (variant.metrics.length === 0) {
    return null;
  }
  return variant.metrics.slice().sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0];
}

export function buildBundleExperimentOverlay(
  experiments: CatalogExperimentResponse[],
): Map<string, BundleExperimentVariantOverlay[]> {
  const overlay = new Map<string, BundleExperimentVariantOverlay[]>();
  experiments.forEach((experiment) => {
    experiment.variants.forEach((variant) => {
      if (!variant.bundleSlug) {
        return;
      }
      const metric = latestMetric(variant);
      const summary: BundleExperimentVariantOverlay = {
        experimentSlug: experiment.slug,
        experimentName: experiment.name,
        status: experiment.status,
        variantKey: variant.key,
        isControl: variant.isControl,
        bundleSlug: variant.bundleSlug,
        guardrailBreached: metric?.guardrailBreached ?? false,
        latestAcceptanceRate: metric?.acceptanceRate ?? null,
        latestSampleSize: metric?.sampleSize ?? null,
      };
      const bucket = overlay.get(variant.bundleSlug) ?? [];
      bucket.push(summary);
      overlay.set(variant.bundleSlug, bucket);
    });
  });
  return overlay;
}

export function filterExperimentsForRecommendations(
  recommendations: CatalogBundleRecommendation[],
  experiments: CatalogExperimentResponse[],
): CatalogExperimentResponse[] {
  if (recommendations.length === 0) {
    return experiments;
  }
  const recommendationSlugs = new Set(recommendations.map((item) => item.slug));
  return experiments.filter((experiment) =>
    experiment.variants.some((variant) => variant.bundleSlug && recommendationSlugs.has(variant.bundleSlug)),
  );
}

export function hasGuardrailBreaches(variants: BundleExperimentVariantOverlay[] | undefined): boolean {
  if (!variants || variants.length === 0) {
    return false;
  }
  return variants.some((variant) => variant.guardrailBreached || variant.status === "paused");
}
