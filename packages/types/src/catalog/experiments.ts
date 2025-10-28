export type CatalogExperimentMetricApi = {
  window_start: string;
  lookback_days: number;
  acceptance_rate: number;
  acceptance_count: number;
  sample_size: number;
  lift_vs_control: number | null;
  guardrail_breached: boolean;
  computed_at: string;
};

export type CatalogExperimentVariantApi = {
  key: string;
  name: string;
  weight: number;
  is_control: boolean;
  bundle_slug: string | null;
  override_payload: Record<string, unknown>;
  metrics: CatalogExperimentMetricApi[];
};

export type CatalogExperimentResponseApi = {
  slug: string;
  name: string;
  description: string | null;
  status: string;
  guardrail_config: Record<string, unknown>;
  sample_size_guardrail: number;
  variants: CatalogExperimentVariantApi[];
  provenance: Record<string, unknown>;
};

export type CatalogExperimentMetric = {
  windowStart: Date;
  lookbackDays: number;
  acceptanceRate: number;
  acceptanceCount: number;
  sampleSize: number;
  liftVsControl: number | null;
  guardrailBreached: boolean;
  computedAt: Date;
};

export type CatalogExperimentVariant = {
  key: string;
  name: string;
  weight: number;
  isControl: boolean;
  bundleSlug: string | null;
  overridePayload: Record<string, unknown>;
  metrics: CatalogExperimentMetric[];
};

export type CatalogExperimentResponse = {
  slug: string;
  name: string;
  description: string | null;
  status: string;
  guardrailConfig: Record<string, unknown>;
  sampleSizeGuardrail: number;
  variants: CatalogExperimentVariant[];
  provenance: Record<string, unknown>;
};

export function normalizeCatalogExperiment(
  payload: CatalogExperimentResponseApi,
): CatalogExperimentResponse {
  return {
    slug: payload.slug,
    name: payload.name,
    description: payload.description,
    status: payload.status,
    guardrailConfig: payload.guardrail_config,
    sampleSizeGuardrail: payload.sample_size_guardrail,
    variants: payload.variants.map((variant) => ({
      key: variant.key,
      name: variant.name,
      weight: variant.weight,
      isControl: variant.is_control,
      bundleSlug: variant.bundle_slug,
      overridePayload: variant.override_payload ?? {},
      metrics: variant.metrics.map((metric) => ({
        windowStart: new Date(metric.window_start),
        lookbackDays: metric.lookback_days,
        acceptanceRate: metric.acceptance_rate,
        acceptanceCount: metric.acceptance_count,
        sampleSize: metric.sample_size,
        liftVsControl: metric.lift_vs_control,
        guardrailBreached: metric.guardrail_breached,
        computedAt: new Date(metric.computed_at),
      })),
    })),
    provenance: payload.provenance ?? {},
  };
}

export type CatalogExperimentGuardrailEvaluationApi = {
  experiment: string;
  breaches: Array<{
    variant_key: string;
    bundle_slug: string | null;
    breaches: string[];
    latest_metric: CatalogExperimentMetricApi | null;
  }>;
  evaluated_at: string;
};

export type CatalogExperimentGuardrailEvaluation = {
  experiment: string;
  breaches: Array<{
    variantKey: string;
    bundleSlug: string | null;
    breaches: string[];
    latestMetric: CatalogExperimentMetric | null;
  }>;
  evaluatedAt: Date;
};

export function normalizeCatalogExperimentGuardrails(
  payload: CatalogExperimentGuardrailEvaluationApi,
): CatalogExperimentGuardrailEvaluation {
  return {
    experiment: payload.experiment,
    breaches: payload.breaches.map((entry) => ({
      variantKey: entry.variant_key,
      bundleSlug: entry.bundle_slug,
      breaches: [...entry.breaches],
      latestMetric: entry.latest_metric
        ? {
            windowStart: new Date(entry.latest_metric.window_start),
            lookbackDays: entry.latest_metric.lookback_days,
            acceptanceRate: entry.latest_metric.acceptance_rate,
            acceptanceCount: entry.latest_metric.acceptance_count,
            sampleSize: entry.latest_metric.sample_size,
            liftVsControl: entry.latest_metric.lift_vs_control,
            guardrailBreached: entry.latest_metric.guardrail_breached,
            computedAt: new Date(entry.latest_metric.computed_at),
          }
        : null,
    })),
    evaluatedAt: new Date(payload.evaluated_at),
  };
}
