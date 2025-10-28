export type CatalogBundleRecommendationMetricsApi = {
  score: number;
  acceptance_rate: number | null;
  acceptance_count: number;
  queue_depth: number;
  lookback_days: number | null;
  cms_priority: number;
  notes: string[];
};

export type CatalogBundleRecommendationProvenanceApi = {
  source: string | null;
  cache_layer: string;
  cache_refreshed_at: string;
  cache_expires_at: string;
  cache_ttl_minutes: number;
  notes: string[];
};

export type CatalogBundleRecommendationApi = {
  slug: string;
  title: string;
  description?: string | null;
  savings_copy?: string | null;
  components: string[];
  metrics: CatalogBundleRecommendationMetricsApi;
  provenance: CatalogBundleRecommendationProvenanceApi;
};

export type CatalogRecommendationResponseApi = {
  product_slug: string;
  resolved_at: string;
  freshness_minutes: number | null;
  cache_layer: string;
  fallback_copy: string | null;
  recommendations: CatalogBundleRecommendationApi[];
};

export type CatalogBundleRecommendation = {
  slug: string;
  title: string;
  description: string | null;
  savingsCopy: string | null;
  components: string[];
  score: number;
  acceptanceRate: number | null;
  acceptanceCount: number;
  queueDepth: number;
  lookbackDays: number | null;
  cmsPriority: number;
  notes: string[];
  provenance: CatalogBundleRecommendationProvenance;
};

export type CatalogBundleRecommendationProvenance = {
  source: string | null;
  cacheLayer: string;
  cacheRefreshedAt: Date;
  cacheExpiresAt: Date;
  cacheTtlMinutes: number;
  notes: string[];
};

export type CatalogRecommendationResponse = {
  productSlug: string;
  resolvedAt: Date;
  freshnessMinutes: number | null;
  cacheLayer: string;
  fallbackCopy: string | null;
  recommendations: CatalogBundleRecommendation[];
};

export function normalizeCatalogRecommendation(
  payload: CatalogRecommendationResponseApi,
): CatalogRecommendationResponse {
  return {
    productSlug: payload.product_slug,
    resolvedAt: new Date(payload.resolved_at),
    freshnessMinutes: payload.freshness_minutes,
    cacheLayer: payload.cache_layer,
    fallbackCopy: payload.fallback_copy,
    recommendations: payload.recommendations.map((item) => ({
      slug: item.slug,
      title: item.title,
      description: item.description ?? null,
      savingsCopy: item.savings_copy ?? null,
      components: [...item.components],
      score: item.metrics.score,
      acceptanceRate: item.metrics.acceptance_rate,
      acceptanceCount: item.metrics.acceptance_count,
      queueDepth: item.metrics.queue_depth,
      lookbackDays: item.metrics.lookback_days,
      cmsPriority: item.metrics.cms_priority,
      notes: [...item.metrics.notes],
      provenance: {
        source: item.provenance.source,
        cacheLayer: item.provenance.cache_layer,
        cacheRefreshedAt: new Date(item.provenance.cache_refreshed_at),
        cacheExpiresAt: new Date(item.provenance.cache_expires_at),
        cacheTtlMinutes: item.provenance.cache_ttl_minutes,
        notes: [...item.provenance.notes],
      },
    })),
  };
}
