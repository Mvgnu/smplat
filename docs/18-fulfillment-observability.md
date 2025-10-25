# Fulfillment Observability & Staging Enablement

This note captures the minimal steps required to switch on the fulfillment worker in staging and consume the new runtime telemetry.

## Enable the Worker

1. Provision the environment variables:
   ```bash
   FULFILLMENT_WORKER_ENABLED=true
   FULFILLMENT_POLL_INTERVAL_SECONDS=30   # tighten if you need faster reaction times
   FULFILLMENT_BATCH_SIZE=25              # tune based on postgres sizing and worker throughput
   ```
2. Restart the API process. The application lifespan hook instantiates the worker and logs whether it is running. If the toggle is `false`, the process now emits a structured message so the deployment pipeline can flag misconfigurations.

## Runtime Metrics & Alerts

- `/api/v1/fulfillment/metrics` — existing snapshot of loop counters (processed, failed, retried, dead-lettered) with timing data.
- `/api/v1/fulfillment/health` — current poll interval/batch size plus the metrics snapshot.
- `/api/v1/fulfillment/observability` — **new** aggregated totals suitable for dashboards or alert rules (totals, per-task-type counters, and recent failure/dead-letter metadata).
- `/api/v1/payments/observability` — aggregated checkout/webhook counters (success/failure totals, last failure metadata) behind the internal checkout API key for quick Stripe health checks.

Suggested alert thresholds:

| Signal | Trigger | Action |
| ------ | ------- | ------ |
| `totals.dead_lettered` increases within 5-minute window | Investigate the `events.last_dead_letter_task` and the attached order item; manual intervention likely required. |
| `totals.failed` increases but `totals.retried` stays 0 | Worker is not rescheduling tasks — check DB connectivity, stripe/instagram dependencies, or worker permissions. |
| `loop_errors` metric in `/fulfillment/metrics` increments | Inspect API logs for stack traces; consider pausing the worker while resolving. |

Dashboards can poll `/api/v1/fulfillment/observability` on a 30–60s cadence; the payload is small (<1 KB) and safe for polling.

### Staging Rollout Checklist

1. Configure the environment variables above and restart the API workload.
2. Run the fulfillment smoke test in in-process mode to validate base health:
   ```bash
   python tooling/scripts/smoke_fulfillment.py --in-process
   ```
3. Execute the payments smoke script against staging (requires `CHECKOUT_API_KEY`):
   ```bash
   python tooling/scripts/smoke_checkout.py \
     --base-url https://staging-api.example.com \
     --api-key "$CHECKOUT_API_KEY"
   ```
4. Baseline observability using the combined checker (this command fails if thresholds are exceeded):
  ```bash
  python tooling/scripts/check_observability.py \
    --base-url https://staging-api.example.com \
    --api-key "$CHECKOUT_API_KEY" \
    --max-fulfillment-dead-lettered 0 \
    --max-payment-webhook-failures 1 \
    --max-catalog-zero-results-rate 0.2 \
    --catalog-min-sample-size 10
   ```
5. Create dashboards/alerts that:
   - scrape `/api/v1/fulfillment/observability` and `/api/v1/payments/observability` (secured by the checkout key),
   - watch `totals.failed`/`totals.dead_lettered` for fulfillment and `checkout.totals.failed` or webhook failure buckets for Stripe,
   - notify the on-call channel (Slack/PagerDuty) when thresholds are crossed.
6. Share catalog insights with merchandising:
   ```bash
   python tooling/scripts/export_catalog_insights.py \
     --base-url https://staging-api.example.com \
     --api-key "$CHECKOUT_API_KEY" \
     --format md \
     --output ./catalog-insights.md
   ```
   Import the resulting report into your CMS planning doc to align bundles with trending queries and zero-result searches.

### Prometheus & Grafana Checklist

- **Prometheus scrape**: Add `https://staging-api.example.com/api/v1/observability/prometheus` (replace with the real staging origin) to the Prometheus targets with the `Authorization: Bearer <CHECKOUT_API_KEY>` header. Verify the target reports `UP=1` and update this runbook with the exact URL once staging is live.
- **Grafana dashboard**: Import `docs/20-grafana-dashboard.json` into your staging Grafana stack. Confirm the fulfillment, payments, and catalog panels show non-zero data once traffic flows.
- **Alert rules**: Apply the alert templates in `docs/20-observability-dashboards.md` (dead-letter growth, checkout/webhook failures) and record any custom threshold overrides here for future operators. Add catalog quality alerts using the new `smplat_catalog_zero_results_rate` gauge so the SLO matches the CI checker.
- **Runbook hygiene**: Capture staging-specific values (API base URL, Prometheus job label, Grafana dashboard ID, alert routing) in this section after verification so on-call responders have canonical references.

## CI Smoke Coverage

Use the updated script to guard deployments:

```bash
python tooling/scripts/smoke_fulfillment.py --base-url https://staging-api.example.com
# or in-process during CI:
python tooling/scripts/smoke_fulfillment.py --in-process

# Validate checkout + payments observability
python tooling/scripts/smoke_checkout.py --base-url https://staging-api.example.com --api-key "$CHECKOUT_API_KEY"

# Consolidated observability check (fails on threshold breaches)
python tooling/scripts/check_observability.py \
  --base-url https://staging-api.example.com \
  --api-key "$CHECKOUT_API_KEY" \
  --max-fulfillment-dead-lettered 0 \
  --max-payment-checkout-failures 0 \
  --max-payment-webhook-failures 0 \
  --max-catalog-zero-results-rate 0.2 \
  --catalog-min-sample-size 10
```

The smoke tests now verify the observability endpoints in addition to health/metrics. Integrate them in CI/CD so releases fail fast when telemetry signals regress.
