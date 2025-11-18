# Account Validation Runbook

Operators can validate customer handles, capture baseline metrics, and persist ownership evidence using the MetricSourcer tooling introduced in Track 0.

## Prerequisites

- FastAPI deployed with `METRIC_SCRAPER_API_BASE_URL` / `METRIC_SCRAPER_API_TOKEN` configured (or `METRIC_VALIDATION_MANUAL_FALLBACK=true` for manual-only environments).
- Checkout API key shared between Next.js and FastAPI (`CHECKOUT_API_KEY`).
- Ops Slack channel for posting validation summaries (see template below).

## Web Workflow (`/admin/reports`)

1. Navigate to **Admin → Reporting → Account validation testbed**.
2. Select the target platform and enter the handle (leading `@` optional). Supply the `customer_profile_id` if the profile already exists.
3. When scraper coverage is incomplete, fill the “Manual metrics” fields (followers, following, engagement %, sample size, last post timestamp). These values will be persisted to `customer_social_accounts`.
4. Submit the form. The preview panel shows:
   - Snapshot metadata (source, scrape timestamp, quality score, warnings).
   - Normalized metrics (followers, engagement, etc.).
   - Persisted account payload (verification status, baseline snapshot, metadata).
5. Share the rendered JSON + warnings in the ops channel with the template:
   ```
   :satellite: Metric validation
   - Handle: @brand (instagram)
   - Source: scraper
   - Followers: 12,300 | Avg likes: 480 | Engagement: 4.1%
   - Notes: manual bio code confirmed
   ```

## CLI Workflow

For CI jobs or local smoke tests run:

```bash
python tooling/scripts/validate_social_account.py instagram @brand \
  --api https://api.smplat.local \
  --api-key $CHECKOUT_API_KEY \
  --manual followers=12300 avgLikes=480 engagementRatePct=4.1 sampleSize=12
```

The script prints the snapshot + persisted account JSON to stdout. Use this path in automated monitors to ensure the scraper token hasn’t expired.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `503 scraper_unavailable` | Ensure `METRIC_SCRAPER_API_BASE_URL`/`TOKEN` are set and reachable. If still failing, leave manual metrics populated and log a tracker entry referencing the upstream incident. |
| Verification stuck in `pending` | Snapshot came from manual fallback. Provide ownership proof (bio code, DM screenshot) and rerun validation once the scraper passes. |
| `customer_social_account_id` missing on order items | Re-run the validation testbed after linking the `customer_profile_id`, then update the order item by calling the order management tooling (pending Track 0 state machine work). |

## Related Docs

- [`docs/metric-sourcing.md`](../metric-sourcing.md) – architecture, schema, and roadmap context.
- [`docs/storefront-platform-roadmap.md`](../storefront-platform-roadmap.md) – Track 0 priorities.
