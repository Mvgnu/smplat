# Bundle Recommendation Engine Runbook

## Overview
- **Service**: `CatalogRecommendationService`
- **API**: `POST /api/v1/catalog/recommendations`
- **Cache Layers**: in-memory (10m TTL) with Postgres persistence (`catalog_recommendation_cache`).
- **Data Inputs**:
  - `catalog_bundles`: curated bundle definitions with CMS priorities.
  - `catalog_bundle_acceptance_metrics`: Postgres-backed acceptance telemetry.
  - Fulfillment backlog via `fulfillment_tasks` joined to product slugs.

## Smoke Test
1. Seed at least one bundle for a storefront slug via SQL or Payload.
2. Run `poetry run pytest apps/api/tests/catalog/test_bundle_acceptance.py` to verify instrumentation + aggregation.
3. Call `POST /api/v1/catalog/recommendations` with a valid slug + `X-API-Key` to confirm non-empty `recommendations`.
4. Trigger `POST /api/v1/catalog/recommendations/refresh` to ensure cache invalidation returns a fresh payload.

## Heuristics
- **Score = (150 - cms_priority) + acceptance_rate*100 - min(queue_depth*1.5, 50)**.
- Notes surface when acceptance is missing/low/high and when queue depth crosses 0 or 15 tasks.
- Acceptance metrics prefer the smallest `lookback_days`; fallback selects the most recent computation.

## Cache Management
- Memory cache reset: `await CatalogRecommendationService.reset_cache()` (used in tests).
- Persistent cache table: `catalog_recommendation_cache`.
  - To purge one slug: `DELETE FROM catalog_recommendation_cache WHERE primary_slug = '<slug>';`.
  - TTL defaults to 10 minutes; API `freshness_minutes` overrides.

## Operational Guardrails
- Endpoint requires checkout API key (`CHECKOUT_API_KEY`).
- Lightweight rate limiting: 8 requests per slug per 5 seconds. 429 indicates abuse.
- If fallback response persists, verify:
  - Bundle definitions exist for the slug.
  - Acceptance metrics records exist (`catalog_bundle_acceptance_metrics`).
  - Fulfillment backlog query is reachable (ensure `order_items.product_id` populated).
  - CMS override metadata (`catalog_bundles.metadata -> cms_override`) is valid JSON.

## Acceptance Telemetry
- Order creation now records bundle acceptance via `BundleAcceptanceService` (orders endpoint).
- `BundleAcceptanceAggregator.recompute()` backfills metrics over configurable windows.
- Events update `catalog_bundle_acceptance_metrics.acceptance_count`, `sample_size`, and `acceptance_rate` with 4-decimal precision.
- Run aggregation as part of maintenance jobs (cron) prior to large experiments.

## CMS Overrides & Tooling
- Override payloads live under `catalog_bundles.metadata -> cms_override`.
- API endpoints:
  - `POST /api/v1/catalog/recommendations/override` – persist overrides (title, description, savings, priority, campaign, tags) and purge cache.
  - `POST /api/v1/catalog/recommendations/refresh` – force recomputation for a slug.
- Admin UI: `/admin/merchandising/bundles` surfaces live recommendations, applied notes, and override forms.
  - Requires `CHECKOUT_API_KEY` to issue API calls.
  - "Refresh cache" calls the refresh endpoint.
  - "Apply override" posts to the override endpoint and revalidates the page.

## Experiment Launch Checklist
1. Confirm acceptance metrics updating (inspect latest row in `catalog_bundle_acceptance_metrics`).
2. Review storefront payload via `/admin/merchandising/bundles`.
3. Apply override with campaign tags + priority adjustments.
4. Refresh cache to propagate override and confirm provenance badges surface in storefront (`bundle.provenance.notes`).
5. Monitor acceptance deltas over first 24h; rerun aggregator for validation.

## Frontend Integration
- Loader: `fetchCatalogBundleRecommendations` (`apps/web/src/server/catalog/recommendations.ts`).
- Types: `@smplat/types` normalized helpers.
- Storefront component renders dynamic bundles alongside CMS marketing bundles.

## Troubleshooting
- Missing bundles: ensure CMS or SQL seed writes to `catalog_bundles`.
- Acceptance anomalies: inspect `catalog_bundle_acceptance_metrics` for stale timestamps.
- Queue anomalies: join `fulfillment_tasks` to `order_items` and validate product slugs.
- Logs: enable Loguru debug around `CatalogRecommendationService._compute_snapshot` for deep inspection.
