# Trust pipeline operations runbook

This runbook documents how to monitor and maintain the checkout trust pipeline that binds Payload content to fulfillment metrics.

## Quick reference

- **CMS collection:** `checkout-trust-experiences`
- **Backend service:** `apps/api/src/smplat_api/services/fulfillment/metrics.py`
- **API endpoints:** `POST /api/v1/trust/experiences`, `POST /api/v1/trust/metrics/purge`
- **Front-end resolver:** `apps/web/src/server/cms/trust.ts`
- **Preview route:** `/trust-preview/[id]` (requires `CHECKOUT_PREVIEW_TOKEN` in the query string when configured)

## Refresh cadence

Metrics use a **two-tier cache**:

- **In-memory:** 15-minute TTL inside the FastAPI worker for hot requests.
- **Persistent:** `fulfillment_metric_cache` Postgres table. Entries inherit the metric's default freshness window and are automatically evicted when expired or via the purge endpoint.

Each metric definition includes a default freshness window that also governs the persistent TTL:

- `fulfillment_sla_on_time_pct` – 1440 minutes (24 hours)
- `first_response_minutes` – 360 minutes (6 hours)
- `nps_trailing_30d` – 1440 minutes (24 hours)
- `fulfillment_backlog_minutes` – 120 minutes (2 hours)
- `fulfillment_staffing_coverage_pct` – 180 minutes (3 hours)
- `fulfillment_delivery_sla_forecast` – 60 minutes (1 hour)

If the storefront reports a `stale` badge, verify whether the freshness window should be tightened or whether the cache needs to be invalidated.

## Regenerating metrics

1. Call `POST /api/v1/trust/metrics/purge` with the relevant `metric_id` (or omit the field to flush all metrics). The endpoint responds with the purged identifiers.
2. Re-run the checkout flow and confirm that badges report `fresh` in `/trust-preview/checkout`. Provenance metadata now includes cache layer, refreshed timestamp, and TTL diagnostics.
3. If values remain stale, inspect the source tables:
   - `fulfillment_tasks` for schedule/completion timestamps
   - `order_items` + `orders` for first response calculations
   - `fulfillment_tasks.result` JSON for embedded `nps_score` payloads
   - `fulfillment_tasks` queue depth (pending/in_progress) for backlog minutes
   - `fulfillment_tasks` schedule/completion counts over the last 24 hours for staffing coverage
   - `fulfillment_staffing_shifts` for staffed capacity windows feeding SLA forecasts
4. If a dataset backfill is in progress, keep the metric in an `unsupported` state (via CMS preview bindings) until the upstream data is complete. The storefront surfaces provenance notes from the API response.

### Metadata column collision postmortem (2024-05)

- **Incident:** backend test suite failed because SQLAlchemy models in `onboarding.py` defined attributes named `metadata`, shadowing the declarative base attribute. Instantiating these models raised `AttributeError: 'DeclarativeMeta' object has no attribute 'metadata'`.
- **Fix:** renamed ORM attributes to `metadata_json` while retaining the underlying `metadata` column via `Column("metadata", JSON, ...)`. Updated all services and API serializers to use the new attribute name.
- **Regression coverage:** added `apps/api/tests/test_fulfillment_metrics_service.py` to exercise the FastAPI trust metrics contract, including cache safety via an autouse fixture.
- **Prevention:** when adding JSON blobs to declarative models, suffix attribute names with `_json` (or similar) to avoid clashing with SQLAlchemy internals, and extend regression coverage before exposing new metrics.

## Adding a new metric

1. **Catalog entry** – update `FulfillmentMetricsService._definitions` with the new metric ID, source, default freshness window, and computation function.
2. **CMS options** – append the metric option to `metricOptions` within `CheckoutTrustExperiences.ts` and document preview copy, especially new metadata keys exposed to operators.
3. **Documentation** – list the metric in `docs/cms/trust-content.md` with a short description and provenance.
4. **Front-end copy** – ensure checkout components handle the new metric (tooltips, fallbacks, preview badges).
5. **Testing** – hit `POST /api/v1/trust/experiences` with the new metric ID and confirm the verification payload before publishing CMS changes.

## Rollback procedure

- Switch the checkout trust modules to fallback copy by clearing metric bindings in Payload (remove the metric group on each card). Checkout will default to `fallbackValue` without rendering badges.
- If API-level issues occur, temporarily disable the call to `/api/v1/trust/experiences` by setting `CHECKOUT_API_KEY` to an empty string in the storefront environment. The server will skip live resolutions.
- Update this runbook and `docs/15-implementation-roadmap.md` with the incident summary during post-mortem.

## Monitoring checklist

- Checkout page shows verified badges with current timestamps.
- `/trust-preview/checkout` reflects draft copy and highlights any stale or missing metrics.
- API logs do not report unsupported metric IDs.
- `FulfillmentMetricsService` cache size remains bounded (no unbounded metric IDs).

Keep this runbook up to date as new metrics or automation layers are introduced.
