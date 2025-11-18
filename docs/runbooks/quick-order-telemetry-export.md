# Quick-Order Telemetry Export Runbook

Capture and distribute quick-order funnel telemetry so Snowflake/S3 mirrors the retention used by `/admin/onboarding` + `/admin/reports`.

## Storage model

- Events land in `.telemetry/quick-order-events.ndjson` inside the Next.js workspace (see `apps/web/src/server/telemetry/quick-order-storage.ts`).
- The capture route (`POST /api/telemetry/quick-order`) appends `quick_order.start|abort|complete` events and enforces a rolling window of 5 000 rows (~5 MB at current payload sizes).
- The admin dashboard derives funnel analytics by reading this NDJSON via `readQuickOrderEvents()`, so keeping the file healthy directly benefits `/admin/onboarding` + `/admin/reports`.

## Export API

Use the new export route when you need the raw NDJSON:

```bash
curl -fsSL \
  "https://<your-admin-host>/api/telemetry/quick-order/export?limit=5000" \
  -o quick-order-events.ndjson
```

- Response headers include `Content-Type: application/x-ndjson`, `Cache-Control: no-store`, and `X-Quick-Order-Events`.
- Omit `limit` (or set it above 5 000) to stream the entire retained window. Specify a lower limit for incremental checks.
- When no events exist yet, the route returns `404` so cron jobs can skip uploading empty snapshots.

## GitHub Action template

The export card piggybacks on the same pattern as the guardrail follow-up workflow. Minimal example:

```yaml
name: quick-order-telemetry-export

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - name: Download NDJSON
        run: |
          curl -fsSL "$QUICK_ORDER_EXPORT_URL" -o quick-order-events.ndjson
        env:
          QUICK_ORDER_EXPORT_URL: ${{ secrets.QUICK_ORDER_EXPORT_URL }}
      - name: Upload to S3
        run: |
          aws s3 cp quick-order-events.ndjson "s3://${{ secrets.QUICK_ORDER_EXPORT_BUCKET }}/quick-order/${{ github.run_id }}.ndjson" \
            --content-type application/x-ndjson
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.QUICK_ORDER_EXPORT_AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.QUICK_ORDER_EXPORT_AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ secrets.QUICK_ORDER_EXPORT_AWS_REGION }}
```

- Store the export route URL (including auth/session details if applicable) in `QUICK_ORDER_EXPORT_URL`.
- Rotate artifacts or add `aws s3 mv` commands if you prefer daily folders (e.g., `quick-order/YYYY/MM/DD/...`).

## Repository workflow

- `.github/workflows/quick-order-telemetry-export.yml` implements the production job:
  - Runs every 30 minutes (plus ad-hoc `workflow_dispatch`) and curls `/api/telemetry/quick-order/export`.
  - Accepts `404` responses (no events yet) and posts a Slack info message instead of failing.
  - Streams successful downloads to S3 using `QUICK_ORDER_EXPORT_BUCKET`/`QUICK_ORDER_EXPORT_S3_PREFIX`, uploads an artifact, and notifies Slack with the event count + S3 key.
  - Publishes `quick-order-export-status.json` (synced event counts + metrics) to `QUICK_ORDER_EXPORT_STATUS_S3_URI`, so Next.js can read the latest metadata.
  - Required secrets: `QUICK_ORDER_EXPORT_URL`, `QUICK_ORDER_EXPORT_BUCKET`, `QUICK_ORDER_EXPORT_S3_PREFIX` (optional), `QUICK_ORDER_EXPORT_AWS_ACCESS_KEY_ID`, `QUICK_ORDER_EXPORT_AWS_SECRET_ACCESS_KEY`, `QUICK_ORDER_EXPORT_AWS_REGION`, `QUICK_ORDER_EXPORT_STATUS_S3_URI`, and optional `QUICK_ORDER_EXPORT_SLACK_WEBHOOK`.
- `/admin/reports` reads `QUICK_ORDER_EXPORT_STATUS_URL` (JSON payload with `{syncedAt, events, downloadUrl, workflowUrl, metrics}`) to render the Snowflake comparison card beside the local funnel. Point this env var at the S3 object written above or any compatible status service. Override the workflow link with `QUICK_ORDER_EXPORT_WORKFLOW_URL` if the exporter lives outside this repo.
- `/api/reporting/quick-order-export` proxies the `downloadUrl` provided by the status payload so the dashboard can fetch the NDJSON even when the artifact requires presigned S3 URLs.
- Update the workflow schedule/limits if retention changes (current window: 5 000 events). The job reuses the NDJSON header `X-Quick-Order-Events` for reporting, so the export route must keep that header in sync with retention.

### Status snapshot schema

The JSON blob uploaded to `QUICK_ORDER_EXPORT_STATUS_S3_URI` (and consumed via `QUICK_ORDER_EXPORT_STATUS_URL`) must include:

| Field | Notes |
| --- | --- |
| `syncedAt` | ISO timestamp string reflecting when the NDJSON landed in S3. |
| `events` | Integer count of events exported in the last run. |
| `downloadUrl` | HTTPS URL (often presigned) that `/api/reporting/quick-order-export` can proxy. |
| `workflowUrl` | Optional direct link to the orchestration workflow (defaults to this repo’s Action URL). |
| `metrics.startCount` | Aggregated starts (nullable). |
| `metrics.abortCount` | Aggregated aborts (nullable). |
| `metrics.completeCount` | Aggregated completes (nullable). |
| `metrics.completionRate` | Rounded completion rate percentage (nullable). |

Populate missing metrics with `null` rather than omitting keys so dashboards render consistent placeholders. The admin UI surfaces these fields as Snowflake overlays, delta sparklines, and download toggles.

## Snowflake ingest

1. Land NDJSON files under a stage bucket (`s3://smplat-analytics/quick-order/<date>/events.ndjson`).
2. Issue a COPY command on a cadence aligned with the export workflow:

```sql
COPY INTO analytics.quick_order_events
FROM @analytics.quick_order_stage
FILE_FORMAT = (TYPE = 'JSON')
ON_ERROR = 'ABORT_STATEMENT';
```

3. Downstream dashboards can now join `quick_order.start|abort|complete` pipelines with guardrail exports using `sessionId`/`productId`.
4. Update `docs/data-lake.md` whenever the telemetry schema changes so analytics mirrors the latest metadata (receipt probe status, blueprint context, etc.).

## Quick-order analytics runbook

1. **Retention health** – Confirm `.telemetry/quick-order-events.ndjson` never exceeds 5 000 rows by tailing the file or calling `/api/telemetry/quick-order/export?limit=10`.
2. **Export workflow** – Check the GitHub Action logs when `QUICK_ORDER_EXPORT_STATUS_URL` stops updating. The job should write the NDJSON artifact + `quick-order-export-status.json` on every run.
3. **Status JSON** – Inspect the uploaded JSON (fields listed above) to validate `syncedAt`, `events`, and per-metric counts. Update secrets if the workflow can’t write to the configured bucket/prefix.
4. **Dashboard parity** – `/admin/reports` and `/admin/onboarding` render local telemetry and Snowflake aggregates side-by-side. Use the new toggle + delta sparkline to ensure metrics match. Drift >5% should trigger a Snowflake ingest investigation.
5. **Downstream COPY** – If Snowflake dashboards lag while the status JSON is fresh, verify the COPY command for `analytics.quick_order_events` is still scheduled and that stage files exist under the expected prefix.

## Monitoring & troubleshooting

- Add a Datadog/Filebeat tail on `.telemetry/quick-order-events.ndjson` to confirm retention churn (expect <5 000 rows after rotation).
- Export route returning `500`: inspect Next.js logs for filesystem permissions or corrupted NDJSON lines.
- Export route returning `404`: no quick-order events captured yet—trigger storefront telemetry or reduce the cron frequency until the feature is active.
- Snowflake COPY errors usually mean malformed JSON; re-run the exporter to fetch a fresh NDJSON snapshot, then inspect the failing row locally (`jq . < quick-order-events.ndjson`).
