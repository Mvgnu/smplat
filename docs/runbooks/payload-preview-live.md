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

## Draft preview validation

1. Enable Payload draft mode integration by running the Jest integration suite against the live environment:
   ```bash
   pnpm --filter @smplat/web test:int -- payload.integration
   ```
   - Confirms the marketing loaders fetch the homepage, a generic page, and a published blog post successfully.
   - Patches a blog post title via the Payload REST API, toggles preview mode, and expects the draft content to surface while the published view remains unchanged.
2. Review the test output for `draft preview end-to-end` to ensure the assertions succeeded.
3. If the suite is skipped, verify `PAYLOAD_INTEGRATION_URL` and related env vars are exported.

## Preview endpoint smoke check

1. Trigger the Next.js preview route manually:
   ```bash
   curl -i "${WEB_URL}/api/preview?secret=${PAYLOAD_PREVIEW_SECRET}&provider=payload&redirect=/blog/sample-post"
   ```
2. Confirm the response sets the `smplat-preview-provider` cookie and redirects (302) to the requested slug.
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

- _Pending first live validation_
