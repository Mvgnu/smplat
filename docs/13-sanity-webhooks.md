# Sanity Webhook & Preview Setup

## Secrets & Environment Variables
- `SANITY_PREVIEW_SECRET`: shared secret for enabling Next.js draft mode via `/api/preview?secret=...`.
- `SANITY_REVALIDATE_SECRET`: value expected in Sanity webhook header `x-sanity-signature` for `/api/revalidate`.
- `SANITY_READ_TOKEN` / `SANITY_WRITE_TOKEN`: optional tokens for preview content and local seeding.

Store these in the environment (e.g., Vercel project + FastAPI secrets). Example `.env` entries:
```
SANITY_PREVIEW_SECRET=generated-preview-secret
SANITY_REVALIDATE_SECRET=generated-revalidate-secret
SANITY_READ_TOKEN=sk********
```

## Configuring Sanity Studio
1. In the Sanity Studio settings, create a webhook pointing to `https://<frontend>/api/revalidate`.
2. Set the HTTP method to `POST` and include the header `x-sanity-signature: $SANITY_REVALIDATE_SECRET`.
3. Enable document types `page`, `testimonial`, `faq`, `pricingTier`, `caseStudy`, `blogPost` for the webhook.
4. For preview, configure the Preview tab to hit `/api/preview?secret=$SANITY_PREVIEW_SECRET&redirect=/slug`.

## Local Verification
- Run `pnpm --filter @smplat/web dev` and expose via `ngrok http 3000` (or similar).
- Update webhook URL to point to the tunnel, then publish a document in Sanity—`/api/revalidate` should return `{ revalidated: true }`.
- Visit `/api/preview?secret=...&redirect=/` to enable draft mode locally.

## CI Considerations
- Ensure secrets are present in deployment environment (Vercel + API host).
- Optionally run `pnpm seed:sanity` in preview deployments (requires write token) to populate sample content.
