# Payload Preview & Revalidation Guide

## Environment variables

Set the following variables anywhere `apps/web` and `apps-cms-payload` run:

- `PAYLOAD_PREVIEW_SECRET`: shared token appended to `https://<web>/api/preview?secret=...&provider=payload`.
- `PAYLOAD_REVALIDATE_SECRET`: header value sent as `x-payload-signature` when Payload webhooks POST to `https://<web>/api/revalidate`.
- `WEB_URL`: origin of the marketing site used by Payload when emitting webhook requests (defaults to `http://localhost:3000`).
- Optional `PAYLOAD_REVALIDATE_ENDPOINT`: override when the frontend is reachable under a custom path.

`apps/web/.env.example` and the repository-level `.env.example` include the new keys.

## Preview flow

1. Configure a Preview button in Payload admin that links to:
   ```text
   ${WEB_URL}/api/preview?secret=${PAYLOAD_PREVIEW_SECRET}&provider=payload&redirect=/slug-here
   ```
2. Visiting the link enables Next.js draft mode and redirects to the requested slug. All Payload fetchers already honour the `draft` flag when preview is enabled.
3. Sanity preview remains available while `SANITY_PREVIEW_SECRET` is set; the route validates both secrets for the migration window.

## Revalidation flow

- Every marketing collection (`pages`, `blog-posts`, `faqs`, `testimonials`, `case-studies`, `pricing-tiers`, `site-settings`) now ships `afterChange`/`afterDelete` hooks that POST to the frontend’s `/api/revalidate` endpoint.
- Hooks include the collection slug, the current/previous document, and the resolved environment so the Next.js handler can skip mismatched environments.
- The frontend route maps incoming documents to paths:
  - `pages`: `/` for the `home` slug, otherwise `/${slug}`.
  - `blog-posts`: `/blog` and the individual `/blog/${slug}` page.
  - `site-settings`: `/` and `/blog`.
  - All other collections default to `/`.

### Local verification checklist

1. Export `PAYLOAD_REVALIDATE_SECRET=local-secret` and `WEB_URL=http://localhost:3000` in the Payload app.
2. Run the Payload dev server and the marketing site (`pnpm --filter apps/web dev`).
3. Publish a document in Payload.
4. Inspect the Next.js terminal logs—`/api/revalidate` should log a `200` with the returned paths. Use `pnpm --filter apps/web test revalidate` to execute the Jest route tests in isolation.
