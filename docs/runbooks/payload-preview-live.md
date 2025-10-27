# Payload Preview & Webhook Live Validation Runbook

This runbook verifies preview and webhook behavior against a deployed Payload CMS instance and the marketing frontend.

## Prerequisites

- Access to a Payload environment (cloud or self-hosted) seeded with marketing collections.
- Credentials for the Payload REST API (`PAYLOAD_API_TOKEN`) with permissions to read and update marketing content.
- Network access from the Payload environment to the marketing site's `/api/preview` and `/api/revalidate` endpoints.
- Access to the marketing deployment logs (Vercel, Fly.io, etc.) to confirm revalidation responses.
- Local shell with `pnpm` available and the repository checked out.

## Environment configuration

Populate the following variables when running local scripts:

```bash
export PAYLOAD_INTEGRATION_URL="https://payload.example.com"
export PAYLOAD_INTEGRATION_TOKEN="<api-token>"
export PAYLOAD_INTEGRATION_ENV="production"
export PAYLOAD_INTEGRATION_PREVIEW_SECRET="<preview-secret>"
export PAYLOAD_PREVIEW_SECRET="<preview-secret>"
export PAYLOAD_REVALIDATE_SECRET="<revalidate-secret>"
export WEB_URL="https://marketing.example.com"
```

> NOTE: When the marketing deployment uses environment-specific slugs (e.g. `preview`, `staging`), ensure `WEB_URL` matches the exact origin that Payload webhooks will invoke.

## Timeline history persistence

- Marketing preview timeline snapshots and route analytics are stored in `apps/web/.data/marketing-preview-history.sqlite` via the durable history service introduced for cockpit baseline hardening. Live preview deltas, fallback remediation attempts, and triage note revisions now land in dedicated tables with SHA-256 idempotency hashes so replay requests remain deterministic.
- The history writer enforces retention automatically (default: 24 manifests) and trims associated deltas/remediation/note revision rows at the same time. To prune manually, delete the SQLite file and rerun the preview validation harness (`pnpm payload:validate`) to repopulate baseline manifests.
- For recovery drills, back up the `.sqlite` file before maintenance, then restore it alongside the `.data` directory. Synthetic tests (`apps/web/src/server/cms/__tests__/history-store.test.ts`) validate that persistence, trimming, hashing, and the new artifact ledgers still behave correctly after recovery.

### History API surface

- `GET /api/marketing-preview/history` exposes the persisted manifests with pagination (`limit`, `offset`), route hashing, and optional filters:
  - `route=/landing` restricts results to manifests containing the route (matching via both clear text and the stored route hash).
  - `variant=draft|published` narrows history to manifests with the requested preview state available.
  - `severity=info|warning|blocker` cross-references triage notes to return entries with matching note counts.
  - `actionMode=live|rehearsal` isolates live fallback executions versus rehearsal simulations so cockpit operators can focus on the appropriate ledger.
- Responses include aggregate counts (`aggregates.totalRoutes`, `aggregates.diffDetectedRoutes`) plus governance summaries (`governance.totalActions`, `governance.actionsByKind`) for cockpit dashboards. Note summaries (`notes.total`, `notes.severityCounts`) are derived from triage notes so workbench timelines can prioritise high-risk retrospectives. The payload also surfaces `liveDeltas`, `remediations`, `rehearsals`, and `noteRevisions` arrays so cockpit retrospectives can reconstruct intra-manifest activity without rehydrating the SSE stream or fallback endpoints.
- Every response now carries an `analytics` object that powers predictive diagnostics in the cockpit:
  - `regressionVelocity` reports average/current diff drift per hour with confidence weighting.
  - `severityMomentum` tracks rate-of-change for info/warning/blocker notes to forecast operator load.
  - `timeToGreen` supplies a linear forecast (`forecastAt`, `forecastHours`, `slopePerHour`, `confidence`).
  - `recommendations` aggregates remediation fingerprints with suggestion text, occurrence counts, route coverage, and scoring confidence.
- Default pagination returns the ten newest manifests; increase `limit` (max 25) for broader retrospectives. The API internally hydrates against the full 24-manifest retention window to ensure severity filters remain accurate.

### Cockpit workbench consumption

- The admin Preview Workbench seeds its live capture with `collectMarketingPreviewSnapshotTimeline` and then delegates historical queries to the `useMarketingPreviewHistory` hook.
- The hook uses React Query for caching and background revalidation, merges filter state (`route`, `variant`, `severity`, `limit`, `offset`) into the query key, and persists the last successful payload in `localStorage` (`marketing-preview-history-cache-v3`) for offline replay. Cached payloads now include the delta/remediation/note revision ledgers so offline retrospectives retain the same fidelity as live fetches.
- Timeline filter chips issue server-side queries, and pagination controls walk persisted manifests without losing cache state. Cache entries are invalidated whenever the active manifest ID changes so fresh captures surface automatically.
- When the browser reports `navigator.onLine === false` or the history request fails, the hook replays the cached payload and surfaces an "Offline cache" badge. Reconnecting triggers an automatic refresh.
- Diff heatmaps derive from `aggregates.diffDetectedRoutes` while note badges surface `notes.severityCounts`, allowing editors to triage high-risk captures before drilling into the diff view.
- The predictive diagnostics panel surfaces the latest analytics payload, sparkline trendlines, and hashed operator feedback submissions. Offline cache fallback is indicated in the panel header so operators know when forecasts are stale. Feedback entries stay local-only until governance runbooks adopt a durable sink.

### Governance ledger API

- `POST /api/marketing-preview/history/governance` records actions such as approvals or resets. Requests must include `x-preview-signature: ${PAYLOAD_LIVE_PREVIEW_SECRET}`; unauthenticated calls are rejected.
- `POST /api/marketing-preview/fallbacks/simulate` records a rehearsal scenario (`scenarioFingerprint`, `expectedDeltas`, optional `manifestGeneratedAt` and `operatorId`), stores the hashed operator identifier, and responds with the delta between expected and live remediation counts. Use this endpoint to dry-run fallback playbooks without polluting live remediations.
- `GET /api/marketing-preview/fallbacks/rehearsals/:id` returns a persisted rehearsal record plus the latest live remediation comparison so cockpit surfaces can badge simulations alongside production recoveries.
- Payload shape:

  ```jsonc
  {
    "manifestId": "2024-07-01T00:00:00.000Z",
    "actionKind": "approve",
    "actorId": "governor@example.com",
    "metadata": { "route": "/campaigns" },
    "occurredAt": "2024-07-01T00:05:00.000Z"
  }
  ```

  - `actorId` is hashed via SHA-256 (`createHistoryHash`) before storage so cockpit analytics can trend actor behaviour without exposing identifiers.
  - `metadata` is stored verbatim (JSON) for downstream simulations; encrypt at rest if sensitive context is introduced.
- Successful writes immediately surface via the history API, enabling cockpit governance panels to show the latest approvals alongside manifest aggregates.

## Draft preview validation

1. Run the automated validation harness (combines Jest integration + live endpoint smoke tests):
   ```bash
   pnpm payload:validate
   ```
   - Executes the Payload loader integration suite and the preview/webhook smoke script.
   - Requires the environment variables above plus `PAYLOAD_VALIDATION_PREVIEW_PATH` / `PAYLOAD_VALIDATION_BLOG_SLUG` if you need to override defaults (`/blog/sample-post`, `automation-workflows`).
   - Fails fast if preview secrets, webhook signatures, or redirect/cookie flows diverge from expectations.
2. Enable Payload draft mode integration by running the Jest integration suite against the live environment (invoked by the command above):
   ```bash
   pnpm --filter @smplat/web test:int -- payload.integration
   ```
   - Confirms the marketing loaders fetch the homepage, a generic page, and a published blog post successfully.
   - Patches a blog post title via the Payload REST API, toggles preview mode, and expects the draft content to surface while the published view remains unchanged.
3. Review the test output for `draft preview end-to-end` to ensure the assertions succeeded.
4. If the suite is skipped, verify `PAYLOAD_INTEGRATION_URL` and related env vars are exported.

## Preview endpoint smoke check

1. The automation above covers the preview redirect + cookie assertions. To debug manually:
   ```bash
   curl -i "${WEB_URL}/api/preview?secret=${PAYLOAD_PREVIEW_SECRET}&provider=payload&redirect=/blog/sample-post"
   ```
2. Confirm the response sets the `smplat-preview-provider` cookie and redirects (307) to the requested slug.
3. In the browser, load the redirected URL and ensure the preview banner is visible. Disable preview mode via `/api/preview?clear=1` when finished.

## Webhook revalidation

1. From the Payload admin UI, publish the seeded blog post (e.g., **Sample Post**).
2. Observe Payload server logs for the webhook payload containing:
   - `x-cms-provider: payload`
   - `requestId`
   - Document slug and environment metadata.
3. Tail the marketing deployment logs and confirm `/api/revalidate` responds with HTTP 200, logging the same `requestId` and the regenerated paths.
4. Repeat the process after deleting or unpublishing the document, ensuring the handler logs `mode: delete` and schedules the expected paths.

## Troubleshooting

- **401 from `/api/preview`**: verify `PAYLOAD_PREVIEW_SECRET` matches between Payload config, environment variables, and the curl request.
- **Webhook 401/403**: confirm the frontend expects `x-payload-signature` with `PAYLOAD_REVALIDATE_SECRET` and the Payload hook uses the same value.
- **Draft data missing**: ensure Payload collections include the `environment` field and the integration test uses the same `PAYLOAD_INTEGRATION_ENV` as the content.
- **Skipped Jest suite**: the integration tests only run when `PAYLOAD_INTEGRATION_URL` is set. Export the environment variables and rerun.

Document successful validation by appending the date, Payload environment URL, and tester initials to the change log below.

## Change log

- 2025-01-15 — Added automated preview/webhook validation harness (`pnpm payload:validate`).
- 2025-10-27 — Persist live preview deltas, fallback remediation attempts, and triage note revisions alongside manifests; bumped offline cache schema to v2 for delta-aware replay.
- 2026-02-14 — Added rehearsal action persistence, history `actionMode` filtering, and rehearsal simulation APIs for governance dry-runs.
