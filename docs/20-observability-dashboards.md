# Observability Dashboards & Alerts

This guide explains how to import the provided Grafana dashboard, configure Prometheus scraping, and wire alert rules based on the new metrics exposed at `/api/v1/observability/prometheus`.

## Prometheus Scrape Configuration

Add the API to your Prometheus configuration with the checkout API key:

```yaml
scrape_configs:
  - job_name: smplat-api
    metrics_path: /api/v1/observability/prometheus
    scheme: https
    static_configs:
      - targets: ["staging-api.example.com"]
    authorization:
      type: bearer
      credentials: ${CHECKOUT_API_KEY}
    scrape_interval: 30s
    scrape_timeout: 10s
```

> Note: if your Prometheus version does not support bearer tokens, configure an `Authorization` header via `headers`.

## Grafana Dashboard

Import `docs/20-grafana-dashboard.json` into Grafana (Dashboard → Import → Upload JSON). The dashboard includes:

- **Fulfillment Tasks Failed by Type** – time series for failed tasks split by task_type.
- **Dead-lettered Tasks (Latest)** – stat panel highlighting current dead-letter totals.
- **Stripe Webhook Failures** – time series of failed webhooks grouped by event type.
- **Top Catalog Queries** – 5 highest-frequency search queries to assess merchandising demand.
- **Catalog Zero-Result Rate** – stat or time series panel plotting `smplat_catalog_zero_results_rate` with alert thresholds that mirror the CI SLO.

## Alert Rules

Suggested Prometheus alerting rules:

```yaml
groups:
  - name: smplat-observability
    rules:
      - alert: FulfillmentDeadLetterGrowth
        expr: increase(smplat_fulfillment_tasks_dead_lettered_total[10m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Fulfillment dead-letter backlog growing"
          description: "Dead-lettered tasks increased in the last 10 minutes."

      - alert: CheckoutFailuresSpike
        expr: increase(smplat_payments_checkout_failed_total[5m]) > 1
        labels:
          severity: warning
        annotations:
          summary: "Checkout failures detected"
          description: "More than one checkout failure recorded over 5 minutes."

      - alert: WebhookFailuresSpike
        expr: sum(increase(smplat_payments_webhook_events_total{bucket=\"failed\"}[5m])) > 2
        labels:
          severity: warning
        annotations:
          summary: "Stripe webhook failures"
          description: "Webhook failures exceeded threshold in the last 5 minutes."
```

Adjust thresholds to match your SLOs.

## CI Signal Hook

Run the consolidated checker as part of CI/CD (see `docs/19-ci-observability.md`):

```bash
python tooling/scripts/check_observability.py \
  --base-url https://staging-api.example.com \
  --api-key "$CHECKOUT_API_KEY" \
  --max-fulfillment-dead-lettered 0 \
  --max-payment-checkout-failures 0 \
  --max-payment-webhook-failures 0 \
  --max-catalog-zero-results-rate 0.2 \
  --catalog-min-sample-size 10
```

This ensures deployments halt if telemetry deviates before the change reaches production.

## Next Steps: Catalog Analytics & Experiment Feedback

- Promote the **Top Catalog Queries** panel into a weekly report for merchandising; export the table or back the panel with a Prometheus recording rule that captures the top N queries.
- Establish SLOs around catalog health (for example, `zero_results_rate < 2%`, `search_latency_p95 < 500ms`) and encode them either as alerting rules or as thresholds in the GitHub Action variables.
- Annotate Grafana with campaign launches or bundle experiments so query trends can be correlated with CMS changes.
- Share anomalies or fast-rising queries with the marketing team to tune CMS bundles and recommendation blocks on `/products`.
- Leverage the new storefront insights block on `/products` (trending queries, top categories, zero-result rate) as a quick glance view; ensure it stays aligned with the Prometheus/Grafana data by periodically validating both sources against each other.
- Automate the merchandising export (`tooling/scripts/export_catalog_insights.py`) post-deploy to hand curated query lists to CMS editors.
- Add a notification delivery panel that slices `payment_success`, `fulfillment_retry`, `fulfillment_completion`, and `weekly_digest` events. Pair counts with opt-out rates from `notification_preferences` so marketing toggles (especially `marketing_messages`) stay in compliance.
