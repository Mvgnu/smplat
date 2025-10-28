# Fulfillment services

This package contains long-running services that orchestrate fulfillment automation. Key modules include:

- `fulfillment_service.py` – task orchestration and workflow helpers.
- `instagram_service.py` – channel-specific integrations for Instagram.
- `metrics.py` – deterministic trust metrics with two-layer caching and provenance metadata.
- `task_processor.py` – asynchronous fulfillment task execution.

## Metrics cache topology

- In-memory cache: 15-minute TTL for hot lookups inside each FastAPI worker.
- Persistent cache: `fulfillment_metric_cache` table (managed via `FulfillmentMetricCache` ORM). Entries expire according to the metric definition's default freshness window.
- Purge controls: `FulfillmentMetricsService.purge_cache` backs the `POST /api/v1/trust/metrics/purge` endpoint for operator-triggered invalidation.

Refer to `docs/runbooks/trust-pipeline.md` for operational guidance and troubleshooting steps.
