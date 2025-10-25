# Payload Preview & Revalidation Guide

> For hands-on validation steps against a deployed Payload environment, see the accompanying runbook in [`docs/runbooks/payload-preview-live.md`](./runbooks/payload-preview-live.md).

## Environment variables

Set the following variables anywhere `apps/web` and `apps-cms-payload` run:

- `PAYLOAD_PREVIEW_SECRET`: shared token appended to `https://<web>/api/preview?secret=...&provider=payload`.
- `PAYLOAD_REVALIDATE_SECRET`: header value sent as `x-payload-signature` when Payload webhooks POST to `https://<web>/api/revalidate`.
- `WEB_URL`: origin of the marketing site used by Payload when emitting webhook requests (defaults to `http://localhost:3000`).
- Optional `PAYLOAD_REVALIDATE_ENDPOINT`: override when the frontend is reachable under a custom path.
- Optional integration overrides used by the Jest suite when exercising a live Payload instance:
  - `PAYLOAD_INTEGRATION_PREVIEW_SECRET` to override the preview secret sent via `x-payload-preview`.
  - `PAYLOAD_INTEGRATION_DRAFT_SLUG` to target a specific blog post slug with draft coverage (defaults to `automation-workflows`).

`apps/web/.env.example` and the repository-level `.env.example` include the new keys.

## Preview flow

1. Configure a Preview button in Payload admin (`Collection Settings → Admin Panel → Preview Button`) with the URL:
   ```text
   ${WEB_URL}/api/preview?secret=${PAYLOAD_PREVIEW_SECRET}&provider=payload&redirect=<slug>
   ```
   - `<slug>` must be a relative path (e.g. `/blog/post-slug`). The handler will reject external URLs or protocol-relative redirects.
   - The preview endpoint now sets a `smplat-preview-provider` cookie (HttpOnly, SameSite=Lax) so analytics can attribute preview traffic to Payload.
2. When preview is enabled the marketing loaders automatically append `draft=true` and send `x-payload-preview` headers so unpublished documents resolve correctly.
3. Sanity preview remains available while `SANITY_PREVIEW_SECRET` is set; the route validates both secrets for the migration window and records metrics/logs per provider.

## Revalidation flow

- Every marketing collection (`pages`, `blog-posts`, `faqs`, `testimonials`, `case-studies`, `pricing-tiers`, `site-settings`) now ships `afterChange`/`afterDelete` hooks that POST to the frontend’s `/api/revalidate` endpoint.
- Hooks include the collection slug, the current/previous document, derived IDs, and the resolved environment so the Next.js handler can skip mismatched environments.
- Requests now send `x-cms-provider: payload` and a generated `requestId` to correlate failures between Payload logs and the Next.js handler. Non-2xx responses capture response bodies for troubleshooting.
- The frontend route maps incoming documents to paths:
  - `pages`: `/` for the `home` slug, otherwise `/${slug}`.
  - `blog-posts`: `/blog` and the individual `/blog/${slug}` page.
  - `site-settings`: `/` and `/blog`.
  - All other collections default to `/`.

### Local verification checklist

1. Export `PAYLOAD_REVALIDATE_SECRET=local-secret` and `WEB_URL=http://localhost:3000` in the Payload app.
2. Run the Payload dev server and the marketing site (`pnpm --filter apps/web dev`).
3. Publish a document in Payload. Confirm the Payload server logs include the `requestId` and the Next.js logs report a matching `revalidation triggered` message.
4. Trigger a deletion and verify `/api/revalidate` responds with `mode: delete` and the expected `/blog/...` paths.
5. Run automated coverage:
   - `pnpm --filter @smplat/web test:unit -- revalidate` to execute the route tests in isolation.
   - `pnpm --filter @smplat/web test:int` (optional) to exercise a live Payload instance (requires `PAYLOAD_INTEGRATION_URL`).
     This suite now verifies that draft previews resolve through Payload by patching a draft blog post, asserting the published payload remains unchanged, and confirming the preview response surfaces the draft content end to end.
