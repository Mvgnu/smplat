# Payload Operations Runbook

This guide consolidates the day-to-day tasks for operating Payload as the primary CMS once preview and revalidation are live.

## Preview configuration

1. Ensure `PAYLOAD_PREVIEW_SECRET` is configured in both `apps/web` and `apps-cms-payload` environments.
2. In Payload admin, set the preview button URL to:
   ```text
   ${WEB_URL}/api/preview?secret=${PAYLOAD_PREVIEW_SECRET}&provider=payload&redirect=/target-slug
   ```
3. Editors should only enter relative paths. The handler rejects external URLs, protocol-relative paths, and paths containing `..`.
4. When draft mode activates the route emits a JSON log with `message="preview enabled"` and increments the in-memory preview counters. Confirm these logs appear in production monitoring before shipping new content.

## Revalidation webhooks

1. Populate `PAYLOAD_REVALIDATE_SECRET` in Payload and the marketing site. If the marketing site is behind an ingress path, configure `PAYLOAD_REVALIDATE_ENDPOINT` accordingly.
2. Each collection hook sends:
   - `x-payload-signature` with the shared secret.
   - `x-cms-provider: payload` to disambiguate multi-provider setups.
   - A generated `requestId`, `docId`, and `previousDocId` for log correlation.
3. The Next.js route logs `revalidation triggered` events with the provider, collection, derived mode (`update`/`delete`), and sanitized paths. Any `202` responses contain a reason field for skipped revalidation.
4. Watch for repeated `revalidation denied` or `no valid paths` warnings; these increment the `revalidate_skipped` metric and should trigger alerting if they exceed baseline.

## Metrics & monitoring

- Structured logs are JSON objects emitted via `cmsLogger`. Ingest them into your log pipeline and index by `namespace=cms`.
- Preview counters (`preview_*`) and revalidation counters (`revalidate_*`) live in `getCmsMetricSnapshot()`. Expose these through your preferred metrics adapter if Prometheus is available.
- During incidents capture the `requestId` from Payload logs and search for matching entries in Next.js logs to understand end-to-end behaviour.

## Live preview streaming channel

- Configure `PAYLOAD_LIVE_PREVIEW_SECRET` in both Payload and the marketing frontend. Payload hooks sign live preview payloads with this value, and the SSE endpoint rejects unsigned requests.
- Optional: set `PAYLOAD_LIVE_PREVIEW_ENDPOINT` if the marketing site is not hosted at `WEB_URL/api/marketing-preview/stream`.
- Payload's `createLivePreviewPublisher` hook emits Lexical deltas for marketing pages. When the endpoint is unreachable the Payload logger emits `[payload] live preview` warnings with the `requestId`, collection, and route—use these to validate retries.
- The cockpit shows a "Stream offline" badge whenever the SSE connection drops. Restart Payload or the frontend, confirm the badge flips to "Live stream", and watch for fresh entries in the live validation feed.
- If validation responses highlight block errors, use the feed to identify the failing block, update the Payload document, and recheck until the badge returns to "Live clean".

## Secret rotation

1. Generate new values for `PAYLOAD_PREVIEW_SECRET` and `PAYLOAD_REVALIDATE_SECRET`.
2. Update the marketing site environment first and redeploy. Confirm `/api/preview` rejects old secrets.
3. Update the Payload environment variables and restart the Payload instance. Validate that webhook deliveries succeed and preview links continue to work.
4. Document the rotation in your operations changelog, noting the `requestId` samples observed after the rotation.

## Deprecating Sanity

- Once preview and revalidation operate exclusively through Payload for two sprints, begin removing Sanity-specific environment variables from deployment manifests.
- Tag any residual GROQ/PortableText code with `// TODO(payload-migration): remove once Sanity sunset completes` to guide cleanup.
- Update stakeholders weekly using the timeline in `docs/payload-migration.md`.
