# Guardrail Automation Runbook

Keep the guardrail workflow dashboard, Slack snippets, and quick-order telemetry aligned so ops can pause/resume/escalate providers with full evidence.

## Scope

- `/admin/reports` guardrail follow-up queue (`apps/web/src/app/(admin)/admin/reports/page.tsx`)
- Quick-order launcher + PDP prefill (`apps/web/src/components/account/QuickOrderModalLauncher.tsx`, `apps/web/src/app/(storefront)/products/[slug]/product-detail-client.tsx`)
- Slack workflow composer + attachment uploads (`apps/web/src/components/admin/GuardrailSlackWorkflowSnippet.client.tsx`)
- Reporting proxy routes (`apps/web/src/app/api/reporting/*`, including `/api/reporting/guardrail-workflow` for telemetry summaries)
- FastAPI guardrail follow-up endpoints (`apps/api/src/smplat_api/api/v1/endpoints/reporting.py`)
- Telemetry helpers (`apps/web/src/lib/telemetry/events.ts`)

## Environment & Dependencies

1. **Authentication + APIs**
   - `CHECKOUT_API_KEY` (Next.js + FastAPI) is required for `/api/reporting/guardrails/followups`.
   - `API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` must point at the FastAPI host.
2. **Telemetry sink**
   - `NEXT_PUBLIC_TELEMETRY_ENDPOINT` (browser) or `TELEMETRY_ENDPOINT` (server) feeds `recordTelemetryEvent`. When unset, events only log to the console.
3. **Asset uploads**
   - `ASSET_BUCKET`, `ASSET_REGION`, `ASSET_PUBLIC_BASE_URL`, `ASSET_UPLOAD_PREFIX`, and optional `ASSET_S3_ENDPOINT`, `ASSET_S3_FORCE_PATH_STYLE`, `ASSET_S3_ACL`, `ASSET_UPLOAD_EXPIRY_SECONDS` configure `createSignedProductUpload`.
   - `GUARDRAIL_ATTACHMENT_PREFIX` scope uploads (default `guardrail-evidence`). This controls the storage key path for Slack evidence.
4. **Attachment routing**
   - `/api/reporting/guardrail-attachments/upload-url` (Next.js) proxies to the signer in `apps/web/src/server/storage/uploads.ts`.
   - Slack uploads require browser `File` access – confirm browsers allow clipboard + drag/drop (future work adds drag/drop).
5. **Quick-order telemetry context**
   - Delivery proof + readiness probes are pulled from `requireRole` + `fetchReceiptStorageComponent` inside `account/orders` before launching modals.
   - Provider telemetry depends on `/api/v1/fulfillment/providers/automation/*` being healthy so guardrail summaries remain accurate.
6. **Guardrail workflow telemetry summary**
   - `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL` points FastAPI at the Next.js `/api/reporting/guardrail-workflow` endpoint (or any compatible JSON mirror). When configured, provider automation workers persist the latest workflow telemetry snapshot in their run history so `/admin/reports` can cross-reference Slack composer activity per run.

## Quick-Order Workflow Preconditions

1. `QuickOrderModalLauncher` renders the trust snapshot card (`apps/web/src/app/(storefront)/account/orders/page.tsx`):
   - Combines `buildDeliveryProofInsights`, provider telemetry summaries, and receipt storage probe data.
   - `Start quick order` pushes `/products` with `quickOrderSessionId`, `quickOrderProductId`, and platform query params.
2. `startQuickOrderSession` (`apps/web/src/lib/quick-order-session.ts`) stores `{context, expiresAt}` in `sessionStorage` (default TTL 30 minutes). Values include:
   - Product blueprint selections (`CartSelectionSnapshot`)
   - Platform context (id/handle/type)
   - Delivery proof snapshot + provider telemetry counts
3. PDP consumption (`consumeQuickOrderSession` in `product-detail-client.tsx`):
   - Reads `quickOrderSessionId` from the URL, applies saved platform + blueprint selection, then deletes the session.
   - Emits `trackQuickOrderAbort` when sessions expire or mismatch, and `trackQuickOrderComplete` after checkout success (fires from cart/checkout flows).
4. Telemetry semantics (from `apps/web/src/lib/telemetry/events.ts`):
   - `quick_order.start`: fired when the modal launches a session; metadata includes receipt probe status, follower deltas, provider order counts.
   - `quick_order.abort`: fired on dismiss, expiry, or PDP mismatch; includes `reason` + `stage`.
   - `quick_order.complete`: fired post-checkout; include `outcome`.
   - All quick-order events carry `sessionId`, `productId`, `productTitle`, plus guardrail tag overrides for downstream analytics.
   - When `NEXT_PUBLIC_TELEMETRY_ENDPOINT` bypasses the `/api/telemetry` proxy, the client also pings `/api/telemetry/quick-order`, which persists events into `.telemetry/quick-order-events.ndjson` with automatic rotation (5k event retention). The funnel card on `/admin/onboarding` and `/admin/reports` reads from this store, and the same file can now be exported via `GET /api/telemetry/quick-order/export` (documented in `docs/runbooks/quick-order-telemetry-export.md`) for Snowflake/S3 mirroring.

## Guardrail Workflow Board

1. **Data sourcing**
   - `/admin/reports` loads guardrail feeds via `fetchGuardrailFollowUps` (`apps/web/src/server/reporting/guardrail-followups.ts`), which sanitizes FastAPI responses.
   - `buildGuardrailFollowUpQueue` merges alert severity + follow-up feeds into six-card queue snapshots.
   - `GuardrailWorkflowTelemetryCard` fetches summaries through `GET /api/reporting/guardrail-workflow` (optionally `?limit=1000`), which proxies to `fetchGuardrailWorkflowTelemetrySummary` and surfaces action counts, attachment usage, and provider activity pulled directly from `.telemetry/guardrail-workflow-events.ndjson`.
- Provider automation history entries now embed the latest workflow telemetry snapshot returned by FastAPI, and Slack/email alerts reuse the same payload so on-call operators see attachment usage + snippet trends without opening `/admin/reports`. Set `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL` so the automation worker can enrich its history payload.
- Entries now include `attachments` arrays persisted by FastAPI, so the queue and Slack snippet can surface every uploaded screenshot/evidence link alongside the notes.
- Guardrail workflow NDJSON mirrors to S3 via `.github/workflows/guardrail-workflow-telemetry-export.yml`; check `docs/runbooks/guardrail-workflow-telemetry-export.md` when reconciling warehouse vs. local telemetry.

## Workflow Telemetry Troubleshooting

- **Banner shows “Refreshing…” indefinitely:** `/api/reporting/guardrail-workflow` is unreachable or returning 500s. Verify `.telemetry/guardrail-workflow-events.ndjson` exists and that the FastAPI worker can reach `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL`. Hitting `/admin/reports` forces a refresh and logs any server errors.
- **Telemetry looks stale in Slack snippets or queue cards:** The shared SWR hook caches for 60 seconds. Visit `/admin/reports` or `/admin/onboarding` to warm the cache, or append `?limit=500&cache=clear` to `/api/reporting/guardrail-workflow` to invalidate the cache during debugging.
- **Banners show “Workflow telemetry will appear once automation captures activity”:** No `guardrail.workflow` events have been written yet. Trigger a workflow action (Slack copy, attachment upload) or seed the NDJSON file via `pnpm --filter @smplat/web dev` seed scripts before running demos.
2. **Queue interactions**
   - `GuardrailFollowUpQueueClient` renders provider name search, severity toggles, action buttons, and submission forms so ops can slice the queue quickly. Filters persist in the URL + local storage, so deep links shared in Slack reopen the same context.
   - Logging workflow actions calls the Next.js route `/api/reporting/guardrail-followups` (proxy to FastAPI) with `{providerId, action, notes, platformContext}`.
   - Successful submissions dispatch `trackGuardrailAutomation` with metadata: `source: "workflow-board"`, `note`, and provider slug context.
   - Follow-up entries currently re-fetch on page reload; planned enhancement is an optimistic refresh using the POST response payload.
   - Each queue card includes an **Attach evidence** uploader backed by `/api/reporting/guardrail-attachments/upload-url`. Files selected here are persisted alongside the follow-up entry, so the Slack snippet and timelines can replay them later.
   - Conversion cursor context appears on every queue card (when recorded) with a deep link back to `/admin/onboarding` so ops know which historical slice a follow-up referenced.
3. **Back-end persistence**
   - FastAPI endpoint (`apps/api/src/smplat_api/api/v1/endpoints/reporting.py`) validates payloads, then passes them to `GuardrailFollowUpService`.
   - Records land in `provider_guardrail_followup` (notes, platform context, conversion cursor) and update `provider_guardrail_status`.
   - `GuardrailFollowUpNotifier` broadcasts Slack/email digests using the same data contract consumed by `/admin/reports`.

## Slack Workflow Composer & Attachments

1. **Component behavior**
   - `GuardrailSlackWorkflowSnippet.client.tsx` renders severity context, platform summaries, follow-up notes, snippet copy controls, and an inline follow-up form per alert.
   - Buttons trigger `trackGuardrailAutomation` (`slug`/`variantKey` escalate) and `trackGuardrailWorkflow` actions: `slack.copy`, `attachment.upload`, `attachment.remove`, `attachment.copy`, `attachment.tag`, and `slack.followup.log`.
   - Every `guardrail.workflow` event is persisted to `.telemetry/guardrail-workflow-events.ndjson` via the Next.js telemetry proxy. `/admin/reports` surfaces these events in the **Guardrail composer activity** card so ops can audit uploads vs. snippet copies without querying Datadog/Snowflake.
- Provider automation Slack/email alerts now append the same workflow telemetry snapshot (actions captured, attachment totals, top action) fetched via `/api/reporting/guardrail-workflow`, making it easy to gauge attachment usage directly from the digest.
- Guardrail Slack workflow snippets, follow-up queues, onboarding dashboards, and reporting export cards all hydrate via the shared `/api/reporting/guardrail-workflow` hook. This keeps the “workflow telemetry” banner in sync across storefront, admin, and Slack surfaces—if the hook is stale, refresh `/admin/reports` to warm it before copying snippets.
   - Historical attachments from `/api/reporting/guardrails/followups` render inside the composer so operators see existing evidence, tag individual files for the next follow-up, and remove/retag as needed before persisting.
2. **Attachment uploads**
   - Clicking **Upload** invokes `uploadGuardrailAttachment` (`apps/web/src/lib/guardrail-attachments.ts`):
     1. POST `/api/reporting/guardrail-attachments/upload-url` with `{fileName, contentType, contentLength}`.
     2. PUT the file to the signed `uploadUrl`.
     3. Return `{assetUrl, storageKey, size, contentType}` for use inside the snippet.
   - Uploaded files live under `s3://$ASSET_BUCKET/$GUARDRAIL_ATTACHMENT_PREFIX/YYYY-MM-DD/<uuid>-filename`.
   - Clicking **Log follow-up** posts the composer state to `/api/reporting/guardrail-followups` so FastAPI stores attachments + notes, keeping the Slack snippet and guardrail timeline in sync. Tagging a historical attachment reuses the stored metadata without creating duplicative uploads.
3. **Snippet contents**
   - `buildSlackSnippet` compiles provider telemetry, guardrail reasons, platform context, follow-up status, conversion cursors, and attachment URLs.
   - Copying the snippet uses the Clipboard API and records telemetry with `metadata.attachmentCount`.

## Telemetry Reference

| Event | Source | Trigger | Key Metadata |
| --- | --- | --- | --- |
| `quick_order.start` | storefront | Modal launches quick order session (`startQuickOrderSession`) | `sessionId`, product/platform labels, receipt probe status, provider telemetry |
| `quick_order.abort` | storefront | User dismisses, session expires, or PDP rejects context | `reason`, `stage`, guardrail tags derived from platform |
| `quick_order.complete` | storefront | Checkout/cart finalizes quick order path | `outcome`, same snapshot metadata |
| `guardrail.automation` | admin | Queue auto-pause/resume/escalate actions (`GuardrailFollowUpQueueClient`, Slack snippet CTA) | `action`, experiment slug/variant, `providerId`, workflow metadata |
| `guardrail.workflow` | admin | Slack composer copy, attachment upload/remove/copy events (`GuardrailSlackWorkflowSnippet`) | `workflowAction`, `providerId`, `attachment*` metadata |
| `guardrail.alert` | admin | Guardrail digest + alert panels | Severity, target slug/variant |

All events originate from `recordTelemetryEvent`, which proxies via `/api/telemetry` unless `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is set (browser sends directly) or `TELEMETRY_ENDPOINT` is configured for server-side dispatch.

## API Summary

| Route | Layer | Purpose |
| --- | --- | --- |
| `apps/web/src/app/api/reporting/guardrail-followups` (GET/POST) | Next.js | Authenticated proxy for reading + recording follow-ups; requires `CHECKOUT_API_KEY`. |
| `apps/web/src/server/reporting/guardrail-followups.ts` | Next.js server utilities | Sanitizes FastAPI payloads, enforces contracts for `GuardrailFollowUpFeed`. |
| `/api/v1/reporting/guardrails/followups` | FastAPI | Persists follow-ups, updates provider status, returns provider telemetry. |
| `apps/web/src/app/api/reporting/guardrail-attachments/upload-url` | Next.js | Requests S3 presigned upload for Slack attachments (uses `createSignedProductUpload`). |

## Operational Checklist

1. **Before enabling the workflow board**
   - Verify `.env` contains `CHECKOUT_API_KEY`, `ASSET_*`, `GUARDRAIL_ATTACHMENT_PREFIX`, and telemetry endpoints.
   - Run the readiness probes in `/admin/reports` to confirm guardrail feed + provider telemetry load.
2. **Validate quick-order context**
   - From `/account/orders`, launch the quick-order modal and ensure the PDP auto-focuses the saved blueprint when redirected.
   - Confirm `quick_order.start` and `quick_order.abort` events arrive at the telemetry sink (Datadog/Snowflake). Use browser devtools’ Network tab to inspect `/api/telemetry` payloads.
3. **Test attachments**
   - Upload an image in the Slack composer and ensure the signed PUT returns `200`.
   - Copy the snippet; verify `attachmentCount` metadata updates the telemetry event.
   - Click **Log follow-up** with at least one attachment tagged (uploaded or historical) and confirm the FastAPI feed returns the new entry with attachments on refresh.
4. **Record workflow action**
   - Use the queue to log a pause/resume; confirm the FastAPI database table (`provider_guardrail_followup`) captured the record and `provider_guardrail_status` updated.
   - Watch `guardrail.automation` events for the same provider to confirm telemetry parity.

## Troubleshooting

- **`Signed uploads are not configured`**: Ensure `ASSET_BUCKET`, `ASSET_REGION`, and `ASSET_PUBLIC_BASE_URL` are set and the IAM role can issue `PutObject`.
- **`CHECKOUT_API_KEY is required` errors**: Set the key in both Next.js (`.env.local`) and FastAPI (server-side) so the proxy + backend share the same credential.
- **Quick-order session expires immediately**: Browser `sessionStorage` might be blocked (private mode) or TTL too low. Override `DEFAULT_TTL_MS` via `startQuickOrderSession({ ttlMs })` when testing long flows.
- **Telemetry drops**: If `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is empty and the proxy route is not deployed, events silently log to console. Configure either endpoint or instrument `pages/api/telemetry`.
- **Attachments missing in Slack snippet after logging**: Confirm `/api/reporting/guardrail-followups` returned `201` and the FastAPI service recorded the attachments. If the log fails, re-upload/tag the evidence and retry once the API is reachable.
