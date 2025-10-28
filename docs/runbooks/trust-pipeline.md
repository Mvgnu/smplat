# Trust pipeline operations runbook

This runbook documents how to monitor and maintain the checkout trust pipeline that binds Payload content to fulfillment metrics.

## Quick reference

- **CMS collection:** `checkout-trust-experiences`
- **Backend service:** `apps/api/src/smplat_api/services/fulfillment/metrics.py`
- **API endpoint:** `POST /api/v1/trust/experiences`
- **Front-end resolver:** `apps/web/src/server/cms/trust.ts`
- **Preview route:** `/trust-preview/[id]` (requires `CHECKOUT_PREVIEW_TOKEN` in the query string when configured)

## Refresh cadence

Metrics are cached for 15 minutes in-memory inside the FastAPI process. Each metric definition includes a default freshness window:

- `fulfillment_sla_on_time_pct` – 1440 minutes (24 hours)
- `first_response_minutes` – 360 minutes (6 hours)
- `nps_trailing_30d` – 1440 minutes (24 hours)

If the storefront reports a `stale` badge, verify whether the freshness window should be tightened or whether the cache needs to be invalidated.

## Regenerating metrics

1. Connect to the API pod and restart the FastAPI process to clear the in-memory cache, or ship a deploy to refresh naturally.
2. Re-run the checkout flow and confirm that badges report `fresh` in `/trust-preview/checkout`.
3. If values remain stale, inspect the source tables:
   - `fulfillment_tasks` for schedule/completion timestamps
   - `order_items` + `orders` for first response calculations
   - `fulfillment_tasks.result` JSON for embedded `nps_score` payloads

## Adding a new metric

1. **Catalog entry** – update `FulfillmentMetricsService._definitions` with the new metric ID, source, default freshness window, and computation function.
2. **CMS options** – append the metric option to `metricOptions` within `CheckoutTrustExperiences.ts`.
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
