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

- Marketing preview timeline snapshots and route analytics are stored in `apps/web/.data/marketing-preview-history.sqlite` via the durable history service introduced for cockpit baseline hardening.
- The history writer enforces retention automatically (default: 24 manifests). To prune manually, delete the SQLite file and rerun the preview validation harness (`pnpm payload:validate`) to repopulate baseline manifests.
- For recovery drills, back up the `.sqlite` file before maintenance, then restore it alongside the `.data` directory. Synthetic tests (`apps/web/src/server/cms/__tests__/history-store.test.ts`) validate that persistence, trimming, and hashing still behave correctly after recovery.

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
