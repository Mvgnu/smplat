# Metric Sourcing & Validation

Track 0 now ships an end-to-end “Metric Sourcer” flow spanning FastAPI, the admin UI, and runbooks so ops can validate storefront handles before exposing delivery proof to customers.

## Architecture

1. **FastAPI service** – `smplat_api.services.metrics.MetricSourcer` orchestrates third-party scraper calls, manual fallbacks, and persistence. It emits normalized snapshots (followers, engagement, sample size, latency, warnings) and writes them to `customer_social_accounts`.
2. **Data model** – `customer_social_accounts` captures verification status, metadata, baseline/delivery snapshots, and an optional `customer_profile_id`. `order_items` now references social accounts and stores the snapshot that was active when the order was created (`baseline_metrics`, `delivery_snapshots`, `target_metrics`).
3. **API surface** – `POST /api/v1/metrics/accounts/validate` requires the checkout API key and accepts:
   ```jsonc
   {
     "platform": "instagram",
     "handle": "@brand",
     "customerProfileId": "a3f6c0f4-...",
     "manualMetrics": {
       "followers": 12000,
       "avgLikes": 540,
       "sampleSize": 12
     },
     "metadata": {
       "note": "Manual validation while scraper is warming up"
     }
   }
   ```
   The response contains `{ account, snapshot, created }` where `account` reflects the persisted row and `snapshot` surfaces the normalized metrics plus provenance.
4. **Admin UI** – `/admin/reports` now includes the “Account validation testbed.” Operators can select a platform, enter a handle, optionally supply manual metrics, and immediately inspect live snapshots / warnings before linking to an order.
5. **CLI harness** – `python tooling/scripts/validate_social_account.py instagram @brand --manual followers=12000 avgLikes=540` pings the same endpoint for local smoke testing or CI hooks.

## Data Notes

- `customer_social_accounts` uses enums for platform + verification status (`pending|verified|rejected|expired`). Scraper-sourced snapshots mark accounts as `verified`, manual overrides remain `pending` until ownership signals are recorded.
- Baseline snapshots are only set once; every subsequent validation appends to `delivery_snapshots.history` (latest five entries) so we can chart delivery proof deltas later.
- `order_items.customer_social_account_id` enables the order state machine to map fulfillment telemetry back to the validated account without re-querying handles.

## Operations & Next Steps

1. Follow [`docs/runbooks/account-validation.md`](./runbooks/account-validation.md) for UI/CLI procedures, environment variables, and Slack escalation templates.
2. Document third-party scraper credentials in the secret manager and set `METRIC_SCRAPER_API_BASE_URL` / `METRIC_SCRAPER_API_TOKEN` in `apps/api/.env`. Leave `METRIC_VALIDATION_MANUAL_FALLBACK=true` in dev/staging until scraper coverage is 100%.
3. Extend the same payload (baseline + delivery snapshots) into storefront trust cards, delivery proof drip notifications, and provider-specific SLAs once Track 0 completes the order state machine work.

### Storefront Trust Integration

- `/api/v1/orders/delivery-proof/metrics` aggregates delivery snapshots per SKU (filter via `?productId=`) and emits follower/engagement deltas, sample sizes, and freshness metadata.
- Next.js fetches this feed inside `apps/web/src/server/cms/trust.ts`, merges the aggregates with CMS-supplied trust content, and annotates each snapshot with provenance notes (`sampleSize`, `lastSnapshotAt`, etc.).
- Checkout, PDP, and the trust preview route now show verified follower lift when data exists (and automatically fall back to the previous narrative when the feed is empty), so customer-facing trust badges echo the exact before/after metrics ops review in `/admin/orders`.
