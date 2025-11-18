# Guardrail Workflow Telemetry Export Runbook

Stream guardrail workflow evidence (Slack composer + queue telemetry) into S3/Snowflake so automation dashboards and `/admin/reports` stay aligned with the warehouse.

## Storage model

- Events land in `.telemetry/guardrail-workflow-events.ndjson` via the shared telemetry proxy (`POST /api/telemetry`). Retention currently caps at 2 000 rows, matching the GuardrailWorkflowTelemetry card window.
- Server helpers (`apps/web/src/server/telemetry/guardrail-workflow-storage.ts`) keep the NDJSON trimmed and power `/admin/reports` summaries plus Slack history audits.
- Guardrail workflow telemetry carries `workflowAction`, `providerId|providerName`, guardrail tags (platform/status), evidence metadata, and timestamps, making it ideal for automation trend dashboards.

## Export API

`GET /api/telemetry/guardrail-workflow/export` streams the NDJSON snapshot. Example:

```bash
curl -fsSL \
  "https://<your-admin-host>/api/telemetry/guardrail-workflow/export?limit=2000" \
  -o guardrail-workflow-events.ndjson
```

- Response headers mirror the quick-order exporter: `Content-Type: application/x-ndjson`, `Cache-Control: no-store`, plus `X-Guardrail-Workflow-Events`.
- A `404` means the telemetry file is empty—treat it as a skip (no upload) rather than a failure.
- Reduce the `limit` for spot checks or keep the default (`2000`) to download the entire retained window.

## Repository workflow

`.github/workflows/guardrail-workflow-telemetry-export.yml` orchestrates the export every 30 minutes (or via `workflow_dispatch`):

1. Curl the export route above using `GUARDRAIL_WORKFLOW_EXPORT_URL`.
2. Upload the NDJSON to `s3://$GUARDRAIL_WORKFLOW_EXPORT_BUCKET/$GUARDRAIL_WORKFLOW_EXPORT_S3_PREFIX/guardrail-workflow/<timestamp>.ndjson`.
3. Publish a status JSON blob (`guardrail-workflow-export-status.json`) to `GUARDRAIL_WORKFLOW_EXPORT_STATUS_S3_URI`, summarizing `{syncedAt, events, metrics.actionCounts, metrics.attachmentTotals, metrics.providerActivity}`.
4. Attach the NDJSON as an Actions artifact and post Slack updates (success, skip, failure) via `GUARDRAIL_WORKFLOW_EXPORT_SLACK_WEBHOOK`.

### Required secrets/env

| Variable | Purpose |
| --- | --- |
| `GUARDRAIL_WORKFLOW_EXPORT_URL` | Fully-qualified export route (include auth/session tokens if required). |
| `GUARDRAIL_WORKFLOW_EXPORT_BUCKET` | Target S3 bucket for NDJSON snapshots. |
| `GUARDRAIL_WORKFLOW_EXPORT_S3_PREFIX` | Optional folder prefix (omit trailing slash). |
| `GUARDRAIL_WORKFLOW_EXPORT_AWS_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` / `..._AWS_REGION` | AWS credentials for uploads. |
| `GUARDRAIL_WORKFLOW_EXPORT_STATUS_S3_URI` | S3 URI for the JSON status document (optional but recommended). |
| `GUARDRAIL_WORKFLOW_EXPORT_SLACK_WEBHOOK` | Incoming webhook for exporter health notifications. |

## Status snapshot schema

The JSON uploaded to `GUARDRAIL_WORKFLOW_EXPORT_STATUS_S3_URI` contains:

| Field | Description |
| --- | --- |
| `syncedAt` | ISO timestamp for the freshest event encountered. |
| `events` | Count of rows written in the last run. |
| `downloadUrl` | HTTPS link (usually presigned) to the NDJSON file. |
| `workflowUrl` | Link back to the Actions run (or your external cron log). |
| `s3Key` | Raw `s3://` key where the NDJSON resides. |
| `metrics.actionCounts[]` | Top workflow actions with counts + last occurrence timestamps. |
| `metrics.attachmentTotals` | Aggregated attachment usage (`upload`, `remove`, `copy`, `tag`). |
| `metrics.providerActivity[]` | Up to five providers with `{providerId, providerName, totalActions, lastAction, lastActionAt}`. |

Dashboards (or `/admin/reports` overlays) can consume this lightweight JSON to compare warehouse freshness vs. local telemetry without downloading the full NDJSON.

## FastAPI integration

- Set `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL` (FastAPI `.env`) to the internal admin route (`https://<admin-host>/api/reporting/guardrail-workflow?limit=500` or an equivalent cache).
- Provider automation workers call this URL after each run so the recorded history and Slack/email alerts include workflow telemetry snapshots (total actions, attachment usage, top providers). The Next.js automation panels render this metadata beside replay/alert details.
- If the URL is unset or unhealthy the worker logs a warning but still records the run.

## Snowflake ingest

1. Stage NDJSON under a deterministic prefix (`guardrail-workflow/YYYY/MM/DD/`). The exporter already namespaces keys with timestamps + run IDs.
2. Run `COPY INTO analytics.guardrail_workflow_events FROM @analytics.guardrail_workflow_stage FILE_FORMAT = (TYPE = 'JSON') ON_ERROR = 'ABORT_STATEMENT';`.
3. Flatten `workflowAction`, provider fields, guardrail tags, and metadata in downstream views (`SELECT value:workflowAction::string AS workflow_action, ...`).
4. Join with provider catalogs (`provider_id`) or guardrail follow-up feeds to understand which teams are uploading evidence, pausing providers, or copying snippets.

## Monitoring & troubleshooting

1. **Export route health** – Call `/api/telemetry/guardrail-workflow/export?limit=5` locally. A `404` indicates no telemetry; `500` usually means the NDJSON file is corrupted (check server logs).
2. **Retention** – Ensure `.telemetry/guardrail-workflow-events.ndjson` remains <=2 000 rows (`wc -l` or `tail`). If retention exceeds the limit, verify `enforceRetention()` is still invoked.
3. **Workflow failures** – Review GitHub Action logs (curl exit status, AWS upload). Secrets misconfiguration is the most common culprit.
4. **Status JSON drift** – If `/admin/reports` references warehouse aggregates later, confirm the JSON uploaded to `GUARDRAIL_WORKFLOW_EXPORT_STATUS_S3_URI` includes the expected metrics. Delete/re-run the workflow if partial uploads occurred.
5. **Snowflake lag** – Compare `syncedAt` from the status JSON with `max(recorded_at)` in `analytics.guardrail_workflow_events`. If drift >30 minutes, inspect COPY jobs or S3 prefixes for missing files.
