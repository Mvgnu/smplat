# Fulfillment services

This package contains long-running services that orchestrate fulfillment automation. Key modules include:

- `fulfillment_service.py` – task orchestration and workflow helpers.
- `instagram_service.py` – channel-specific integrations for Instagram.
- `metrics.py` – deterministic trust metrics with two-layer caching, provenance metadata, and backlog-aware alerting.
- `task_processor.py` – asynchronous fulfillment task execution.

## Metrics cache topology

- In-memory cache: 15-minute TTL for hot lookups inside each FastAPI worker.
- Persistent cache: `fulfillment_metric_cache` table (managed via `FulfillmentMetricCache` ORM). Entries expire according to the metric definition's default freshness window.
- Purge controls: `FulfillmentMetricsService.purge_cache` backs the `POST /api/v1/trust/metrics/purge` endpoint for operator-triggered invalidation.

### Delivery SLA forecast annotations

- Forecast metadata now includes `forecast_alerts` (e.g., `sla_watch`, `limited_history`, `no_staffing_capacity`) and a human-readable `fallback_copy` string that storefronts surface when live data is degraded.
- Guardrail copy is duplicated into `metadata` and cache snapshots so that Persistent cache reads remain aligned with the latest alert tuning.

Refer to `docs/runbooks/trust-pipeline.md` for operational guidance and troubleshooting steps.
