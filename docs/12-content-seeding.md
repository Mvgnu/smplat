# Content Seeding Guide

## Purpose
> **Fallback notice:** Payload now powers the storefront by default. Only follow these Sanity seeding steps when `CMS_PROVIDER=sanity` is explicitly configured for the temporary fallback window.

Provide repeatable steps to populate the Sanity dataset with baseline marketing content for local development and review environments.

## Prerequisites
- Sanity project (`SANITY_PROJECT_ID`). Datasets will be auto-created.
- Management token for dataset creation (`SANITY_MANAGEMENT_TOKEN`) or authenticated Sanity CLI.
- API token with write access stored in `SANITY_WRITE_TOKEN` (or reuse read token if it has write scope).
- Environment variables available locally (`.env`, `apps/web/.env`).

## Dataset setup and seeding
```bash
# Ensure and seed development dataset
pnpm sanity:setup:dev

# Ensure and seed test dataset (for e2e)
pnpm sanity:setup:test

# Or run individually
pnpm sanity:ensure:dev
pnpm sanity:seed:dev
```

Flags and direct usage:
```bash
node tooling/scripts/ensure-sanity-dataset.mjs --dataset development --project smplat --visibility public --token $SANITY_MANAGEMENT_TOKEN
pnpm -w --filter @smplat/web exec node ../../tooling/scripts/seed-sanity.mjs --dataset development --project smplat --token $SANITY_WRITE_TOKEN
```

> The seed script uses `dotenv` to load `.env`, `apps/web/.env`, and `apps/cms/.env`, then performs `createOrReplace` transactions for seed documents.

## Seeded Documents
- `siteSettings::default`
- `page-home`
- `testimonial-default`
- `product-instagram-growth` — starter marketing content merged into the storefront `instagram-growth` product detail.
- `product-tiktok-growth` — companion landing content aligned with the `tiktok-growth` service configuration.
- Optional: create additional product landing pages (`product-<slug>`) via Sanity Studio to drive storefront marketing content. Each page should include:
  - Hero eyebrow/headline/subheadline for the service.
  - Metrics section (`layout: "metrics"`) with at least three KPIs.
  - Testimonials section (link existing testimonials) for social proof.
  - FAQ items if available.
  - Additional sections for benefits/feature highlights (heading/subheading pairs).

## Extending
- Add additional documents to `tooling/scripts/seed-sanity.mjs` for FAQ entries, case studies, and new `product-<slug>` pages so each storefront service has dedicated marketing blocks.
- Consider using separate dataset for staging to avoid overwriting production content.

## Next Steps
- Automate seeding in CI for review deployments (flag `CI=true`). Use the `test` dataset for isolation.
- Add import/export scripts for backups.
