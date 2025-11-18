# Data Lake Reference

This document tracks the analytics-friendly tables that are sourced from FastAPI + Next.js telemetry so BI tooling, notebooks, and external warehouses stay aligned with storefront and operator surfaces.

## Onboarding Pricing Experiment Segments

| Column | Type | Description |
| --- | --- | --- |
| `event_id` | UUID | Primary key mirroring `onboarding_journey_events.id`. |
| `journey_id` | UUID | Journey that produced the telemetry. |
| `order_id` | UUID | Order tied to the pricing experiment. |
| `order_number` | TEXT | Human-readable order reference if present. |
| `slug` | TEXT | Pricing experiment slug (e.g., `spring-offer`). |
| `variant_key` | TEXT | Variant identifier recorded on checkout/success/account surfaces. |
| `variant_name` | TEXT | Display name for the variant, nullable. |
| `is_control` | BOOLEAN | Whether the variant represents the control cohort. |
| `status` | TEXT | Experiment status (running, paused) when the assignment occurred. |
| `feature_flag_key` | TEXT | Storefront feature flag required to surface the experiment. |
| `assignment_strategy` | TEXT | Assignment hint (“sequential”, “feature_flag_demo”), nullable. |
| `recorded_at` | TIMESTAMP WITH TZ | When FastAPI inserted the event. |

### Source of truth

- FastAPI persists `pricing_experiment_segment` entries to `onboarding_journey_events.metadata`.
- `/api/v1/reporting/onboarding/experiment-events` (implemented in this iteration) flattens each recorded experiment into an export-friendly row with pagination support (`nextCursor` -> `recordedAt`). The admin onboarding console proxies this route for CSV downloads so ops can investigate telemetry without credentials to the analytics API.
- `tooling/scripts/export_onboarding_pricing_segments.py` uses the same service to stream rows to either `stdout`, NDJSON files, or a webhook sink (Kafka/S3 bridge). File-based cursor checkpoints (`--cursor-store file`) capture the oldest exported timestamp so scheduled runs resume automatically.
- `tooling/scripts/export_onboarding_pricing_segments_via_api.py` mirrors the exporter but reaches the reporting endpoint over HTTP (requires `CHECKOUT_API_KEY`). Use it from air-gapped environments that cannot reach the reporting database directly.
- `.github/workflows/onboarding-experiment-export.yml` orchestrates the exporter via Poetry, streams payloads to `ANALYTICS_SEGMENTS_WEBHOOK`, and syncs `onboarding_export_cursor.json` to the S3 URI configured via `ONBOARDING_EXPORT_CURSOR_S3_URI`. Trigger the workflow manually for backfills or inspect the logs when the automated run fails.
- `/admin/reports` surfaces CSV controls plus a server-rendered table of the most recent rows, making it easy to compare ad-hoc downloads with the automated feed without shell access.

### Load procedure

1. Schedule the exporter (GitHub Action or your own cron) with `--sink webhook` pointing to your ingestion tier or `--sink file` for interim NDJSON files.
2. Persist the latest `recordedAt` value after every run (either with `--cursor-store file` or by inspecting the JSON payload) so subsequent invocations can resume via `--cursor <timestamp>`.
3. Land files in S3 (or emit via Kafka), then COPY/ingest into the warehouse table defined above.
4. Downstream BI dashboards join this table with `orders`, `journeys`, or loyalty contexts via `order_id`/`journey_id` to analyze conversion by `{slug, variant_key}`. CSV downloads from `/admin/onboarding` share the same schema, keeping ad-hoc ops exports and the warehouse perfectly aligned.

> **Reminder:** The onboarding operator console uses the same normalized payloads, so discrepancies between BI tables and `/admin/onboarding` should be treated as data freshness issues with this pipeline.

## Quick-order Telemetry Mirror

| Column | Type | Description |
| --- | --- | --- |
| `event_id` | UUID | UUID emitted by the Next.js telemetry capture route. |
| `session_id` | TEXT | Storefront session identifier (nullable if not provided). |
| `event_name` | TEXT | `quick_order.start`, `.abort`, or `.complete`. |
| `product_id` | TEXT | SKU/product identifier tied to the quick-order flow. |
| `product_title` | TEXT | Human readable label used in storefront analytics. |
| `platform_context` | TEXT | Platform slug (Instagram, TikTok, etc.) when provided. |
| `recorded_at` | TIMESTAMP WITH TZ | Timestamp from the event payload (Next.js server clock). |
| `metadata` | VARIANT/JSON | Arbitrary key/value map (outcome, abort `reason`, additional funnel tags). |

### Source of truth

- `.telemetry/quick-order-events.ndjson` stores the last 5 000 events on disk so `/admin/onboarding` can render the funnel in real time.
- `/api/telemetry/quick-order/export` streams the same NDJSON for automation workflows and manual verifications.
- `.github/workflows/quick-order-telemetry-export.yml` runs every 30 minutes, curls the export route, posts a Slack status message, uploads the NDJSON into the configured S3 bucket/prefix, and writes `quick-order-export-status.json` to `QUICK_ORDER_EXPORT_STATUS_S3_URI`.
- `/admin/reports` and `/admin/onboarding` consume the status json (via `QUICK_ORDER_EXPORT_STATUS_URL`) plus the local telemetry snapshot to render comparison charts, workflow controls, and download buttons.

### Status snapshot payload

The JSON pushed to `QUICK_ORDER_EXPORT_STATUS_S3_URI` (and surfaced via `QUICK_ORDER_EXPORT_STATUS_URL`) follows this shape:

| Field | Type | Description |
| --- | --- | --- |
| `syncedAt` | ISO timestamp | When the export workflow successfully mirrored the NDJSON to S3. |
| `events` | Number | Count of events included in the NDJSON snapshot. |
| `downloadUrl` | String | Presigned HTTP URL pointing at the exported NDJSON in S3. |
| `workflowUrl` | String | Link to the orchestration workflow (GitHub Actions by default). |
| `metrics.startCount` | Number | Aggregated quick-order starts found in the export window. |
| `metrics.abortCount` | Number | Aggregated aborts (helpful for delta drift monitoring). |
| `metrics.completeCount` | Number | Aggregated completes synced to Snowflake/S3. |
| `metrics.completionRate` | Number | Rounded completion rate derived from the exported counts. |

### Load procedure

1. Schedule the GitHub Action (or an equivalent job) to upload `quick-order-events.ndjson` into a Snowflake-accessible stage.
2. COPY the NDJSON into `analytics.quick_order_events` (or your equivalent) and parse `metadata` to hydrate abort reasons/outcomes.
3. Join the events with the status payload (or re-derive metrics) to monitor parity between storefront telemetry and the Snowflake view. The `/admin/*` dashboards will highlight the same drift via the delta sparkline toggle.

## Guardrail Follow-Up Feed

| Column | Type | Description |
| --- | --- | --- |
| `follow_up_id` | UUID | Primary key mirroring `provider_guardrail_followup.id`. |
| `provider_id` | TEXT | Provider identifier used across `/admin/fulfillment/providers`. |
| `provider_name` | TEXT | Friendly label at the time of the follow-up. |
| `action` | TEXT | Manual remediation recorded by ops (`pause`, `resume`, `escalate`). |
| `notes` | TEXT | Optional operator notes dispatched to Slack + dashboards. |
| `platform_context_id` | TEXT | Structured platform slug (`instagram`, `shopify`, etc.) captured via guardrail alerts. |
| `platform_context_label` | TEXT | Human readable label (e.g., `Instagram DM Concierge`). |
| `platform_context_handle` | TEXT | Optional handle/username that the follow-up referenced. |
| `platform_context_type` | TEXT | Platform type hint (IG, FB, WhatsApp, etc.). |
| `conversion_cursor` | TEXT | Conversion slice cursor that the operator referenced. `NULL` implies “Live conversion snapshot.” |
| `conversion_href` | TEXT | URL rendered in Slack/UI for direct conversions review. |
| `created_at` | TIMESTAMP WITH TZ | When FastAPI persisted the follow-up. |

### Source of truth

- `/api/v1/reporting/guardrails/followups` is the canonical POST/GET endpoint for manual follow-ups and timeline pagination.
- `tooling/scripts/export_guardrail_followups.py` queries the database directly using the latest cursor (either from `--cursor` or `guardrail_followups_cursor.json`) and emits normalized NDJSON/webhook payloads identical to the REST response.
- `.github/workflows/guardrail-followup-export.yml` runs hourly, hydrates Poetry deps, runs the exporter with `--sink webhook`, and uploads the refreshed cursor JSON to both the configured S3 URI and an Actions artifact so backfills can resume anywhere.
- Slack guardrail digests link to the same conversions cursor/href stored in each row, so audit trails in BI match what operators saw in the UI.

### Load procedure

1. Point `ANALYTICS_GUARDRAIL_WEBHOOK` at an ingestion shim (API Gateway, FastAPI worker, etc.) that writes NDJSON files to your Snowflake stage (e.g., `s3://smplat-analytics/guardrail_followups/dt=%Y-%m-%d/*.ndjson`).
2. Schedule the COPY:

```sql
COPY INTO analytics.guardrail_followups
FROM @analytics.guardrail_followups_stage
FILE_FORMAT = (TYPE = 'JSON' STRIP_OUTER_ARRAY = FALSE)
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
ON_ERROR = 'CONTINUE';
```

3. Optional: run a merge/upsert keyed by `follow_up_id` if your stage can replay rows (the exporter already paginates oldest-first, so a replace load per batch is usually sufficient).
4. Surface dashboards: Looker/Metabase models can join this table to provider metadata + experiment telemetry using `provider_id`. Example:

```sql
SELECT
  f.provider_id,
  p.platform_slug,
  COUNT_IF(f.action = 'pause') AS pauses,
  COUNT_IF(f.action = 'resume') AS resumes,
  COUNT_IF(f.action = 'escalate') AS escalations,
  MAX(f.created_at) AS last_action_at
FROM analytics.guardrail_followups AS f
LEFT JOIN analytics.provider_catalog AS p
  ON p.provider_id = f.provider_id
WHERE f.created_at >= DATEADD(day, -14, CURRENT_TIMESTAMP())
GROUP BY 1, 2
ORDER BY last_action_at DESC;
```

- Reuse this query inside Looker explores to filter by `platform_context_id` or `conversion_cursor` (handy for historical audits). The same fields feed `/admin/reports` and Slack payloads, so discrepancies should be triaged via the exporter workflow logs first.


## Guardrail Workflow Telemetry Mirror

| Column | Type | Description |
| --- | --- | --- |
| `event_id` | UUID | `GuardrailWorkflowTelemetryEvent.id`, uniquely identifying the workflow action. |
| `provider_id` | TEXT | Provider identifier tied to the workflow action (nullable). |
| `provider_name` | TEXT | Display name stored alongside `provider_id` (nullable). |
| `workflow_action` | TEXT | Guardrail workflow action (`attachment.upload`, `note.update`, `queue.pause`, etc.). |
| `recorded_at` | TIMESTAMP WITH TZ | Timestamp emitted from the telemetry proxy when the action occurred. |
| `source` | TEXT | `admin`, `automation`, or `storefront` (current events are `admin`). |
| `guardrail_platform_slug` | TEXT | `guardrail.platformSlug` flattened for analytics joins. |
| `guardrail_status` | TEXT | `guardrail.guardrailStatus` snapshot (“healthy”, “warning”, “breached”), nullable. |
| `metadata` | VARIANT/JSON | Structured payload (attachment IDs, snippet metadata, queue context). |

### Source of truth

- `.telemetry/guardrail-workflow-events.ndjson` persists the last 2 000 `guardrail.workflow` events captured via `/api/telemetry` so `/admin/reports` and Slack summaries stay aligned without warehouse lag.
- `/api/telemetry/guardrail-workflow/export` streams the NDJSON as `application/x-ndjson`, honoring `?limit=` and sending `X-Guardrail-Workflow-Events` for automation.
- `.github/workflows/guardrail-workflow-telemetry-export.yml` curls the export route every 30 minutes (plus manual dispatch), uploads the NDJSON to `s3://$GUARDRAIL_WORKFLOW_EXPORT_BUCKET/$PREFIX/guardrail-workflow/...`, posts Slack notifications, and writes `guardrail-workflow-export-status.json` to `GUARDRAIL_WORKFLOW_EXPORT_STATUS_S3_URI`.
- `docs/runbooks/guardrail-workflow-telemetry-export.md` details the workflow, env vars, curl recipes, and Snowflake ingest steps so ops can diagnose issues or run ad-hoc exports.
- FastAPI’s provider automation alert worker consumes the same JSON via `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL`, embedding workflow snapshots in `/api/v1/fulfillment/providers/automation/status/history` so dashboards can align alert runs with Slack composer activity.
- The status JSON (`metrics.actionCounts`, `metrics.attachmentTotals`, `metrics.providerActivity`) mirrors what Looker tiles need; ingest it alongside the NDJSON so admin dashboards can correlate workflow usage with guardrail breaches.

### Load procedure

1. Ensure the GitHub Action (or your cron job) successfully curls `/api/telemetry/guardrail-workflow/export` and lands NDJSON artifacts under a deterministic prefix (e.g., `guardrail-workflow/YYYY/MM/DD/`).
2. Copy the NDJSON batch into `analytics.guardrail_workflow_events` (or your equivalent warehouse table) via `COPY INTO ... FILE_FORMAT = (TYPE = 'JSON')`, selecting/transforming `workflow_action`, `metadata`, and `guardrail.*`.
3. Retain the JSON status snapshot uploaded by the workflow if downstream dashboards need `actionCounts`, `attachmentTotals`, or provider leaderboards without loading the full NDJSON.
4. When telemetry schema or retention changes, update this section plus the exporter runbook so Snowflake ingestion/jobs stay aligned with `/admin/reports`.
