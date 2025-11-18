# Guardrail Follow-Up Export Runbook

Keep the provider guardrail follow-up feed synchronized between FastAPI, analytics sinks, and Snowflake.

## Script primer

- `tooling/scripts/export_guardrail_followups.py`
  - Flags mirror the onboarding experiment exporter (`--limit`, `--sink stdout|file|webhook`, `--cursor-store file`).
  - Every row includes:
    - `followUpId`, `providerId`, `providerName`
    - `action` (`pause`, `resume`, `escalate`)
    - `notes`, normalized `platformContext`
    - `conversionCursor`, `conversionHref`
    - `createdAt` (UTC ISO8601)
  - `--cursor-store file --cursor-store-path <path>` writes `{cursor, rows, updatedAt}` for resumable runs. Drop this file in git (for testing) or sync to S3 for production.
  - When `--sink webhook`, the exporter posts `{"followUps": [ ... ]}` to `ANALYTICS_GUARDRAIL_WEBHOOK` or `--webhook-url`.

### Dry runs

```bash
poetry run python tooling/scripts/export_guardrail_followups.py --limit 5
poetry run python tooling/scripts/export_guardrail_followups.py \
  --limit 20 \
  --provider-id provider-123 \
  --sink file \
  --file-path /tmp/guardrail.ndjson \
  --cursor-store file \
  --cursor-store-path /tmp/cursors/guardrail_followups.json
```

- Use `--sink stdout` for quick inspection (`jq` friendly).
- Set `DATABASE_URL` (and optionally `ANALYTICS_GUARDRAIL_WEBHOOK`) before running locally.

## GitHub Actions workflow

- `.github/workflows/guardrail-followup-export.yml`
  - Hourly cron (`5 * * * *`) plus manual `workflow_dispatch`.
  - Steps:
    1. Install Poetry deps (`apps/api`).
    2. Optionally download cursor checkpoint from `$GUARDRAIL_EXPORT_CURSOR_S3_URI`.
    3. Run exporter with `--sink webhook` + cursor persistence (`guardrail_followups_cursor.json` in repo root).
    4. Upload the refreshed cursor to S3 (when configured) and always emit a `guardrail-followups-cursor` artifact so ops can recover checkpoints without S3.
    5. Notify success/failure via Slack including exported row counts + next cursor metadata.
  - Required secrets:
    - `GUARDRAIL_EXPORT_DATABASE_URL` – Postgres connection string with read access to `provider_guardrail_followup`.
    - `ANALYTICS_GUARDRAIL_WEBHOOK` – HTTP endpoint that forwards to Snowflake/S3/Kafka.
    - Optional S3/AWS secrets (`GUARDRAIL_EXPORT_CURSOR_S3_URI`, `GUARDRAIL_EXPORT_AWS_ACCESS_KEY_ID`, `GUARDRAIL_EXPORT_AWS_SECRET_ACCESS_KEY`, `GUARDRAIL_EXPORT_AWS_REGION`) for persistent cursors.
- Optional `GUARDRAIL_EXPORT_SLACK_WEBHOOK` for status messages.

### Publishing status to `/admin/reports`

- Set `GUARDRAIL_EXPORT_STATUS_URL` in the Next.js environment to point at a JSON blob with the latest cursor metadata. Example payload:

```json
{
  "cursor": "2026-01-22T04:00:00Z",
  "rows": 842,
  "updatedAt": "2026-01-22T04:05:09Z",
  "downloadUrl": "https://s3.amazonaws.com/smplat-exports/guardrail_followups_cursor.json",
  "workflowUrl": "https://github.com/smplat/smplat/actions/runs/1234567890"
}
```

- `/admin/reports` reads that endpoint hourly to power the “Guardrail export health” card, giving ops a quick status view plus a direct download link.
- The **Download latest NDJSON** button in `/admin/reports` hits `/api/reporting/guardrail-followups/export`, which proxies the `downloadUrl` referenced in the JSON payload. Keep the URL publicly accessible (or presigned) so the proxy can stream the artifact.
- Override the workflow CTA shown in the UI with `GUARDRAIL_EXPORT_WORKFLOW_URL` if you host exports outside the main repo.

### Manual reruns from `/admin/reports`

- Set `GUARDRAIL_EXPORT_TRIGGER_URL` to a workflow endpoint (e.g., GitHub’s `workflow_dispatch` URL) and `GUARDRAIL_EXPORT_TRIGGER_TOKEN` to a bearer token with permission to invoke it.
- Once configured, the Guardrail Export card surfaces a **Run export now** button that posts to `/api/reporting/guardrail-followups/export`’s companion trigger action. Successful clicks dispatch the workflow and revalidate the status widget so ops can confirm the new cursor.
- Use this for emergency backfills—standard cadence should still rely on the scheduled workflow.

### Scheduling outside GitHub

```
0,30 * * * * cd /srv/smplat && \
  DATABASE_URL="$PROD_DATABASE_URL" \
  ANALYTICS_GUARDRAIL_WEBHOOK="$SNOWFLAKE_WEBHOOK" \
  python tooling/scripts/export_guardrail_followups.py \
    --limit 1000 \
    --sink webhook \
    --cursor-store file \
    --cursor-store-path /var/lib/smplat/guardrail_followups_cursor.json
```

- Mirror the same cursor file naming so you can swap between cron + Actions without reconfiguring the exporter.
- Store cursor JSON in S3 or a durable disk. The exporter writes `rows`, `cursor`, and `updatedAt`, making it trivial to monitor progress with Datadog/filebeat.

## Snowflake ingest

1. Point the webhook sink at an API gateway (FastAPI, AWS Lambda, etc.) that lands NDJSON blobs into S3 (`s3://smplat-analytics/guardrail_followups/{date}/export.ndjson`).
2. Schedule a COPY command:

```sql
COPY INTO analytics.guardrail_followups
FROM @analytics.guardrail_followups_stage
FILE_FORMAT = (TYPE = 'JSON' STRIP_OUTER_ARRAY = TRUE)
ON_ERROR = 'ABORT_STATEMENT';
```

- Each row flattens to columns documented in `docs/data-lake.md`. Use staged cursors to guarantee idempotent loads.
- Update `docs/data-lake.md` when you add columns (platform context attributes, conversion hints, telemetry IDs) so BI + ops share the same schema knowledge.
