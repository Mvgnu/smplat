# SMPLAT Payload CMS

Next.js application hosting the [Payload CMS](https://payloadcms.com) admin UI and REST/GraphQL APIs for the marketing site.
The server runs on port `3050` by default and exposes:

- Admin panel at `/admin`
- REST API at `/api/payload/*`
- GraphQL endpoint at `/api/graphql`

## Requirements

- Node.js 20+
- PostgreSQL 14+
- Environment variables (see `.env.example`)

## Scripts

```bash
# Run Payload + Next.js locally on http://localhost:3050
pnpm --filter @smplat/cms-payload dev

# Build the production bundle
pnpm --filter @smplat/cms-payload build

# Start the compiled server
pnpm --filter @smplat/cms-payload start

# Generate Payload TypeScript types (writes ./payload-types.ts)
pnpm --filter @smplat/cms-payload generate:types

# Regenerate the RSC import map after editing collections/blocks
pnpm --filter @smplat/cms-payload generate:importmap
```

## Environment

Create an `apps-cms-payload/.env` file or populate the following variables via the shell:

```bash
PAYLOAD_URL=http://localhost:3050
PAYLOAD_SECRET=change-me
DATABASE_URI=postgres://postgres:postgres@localhost:5432/smplat_payload
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=admin123
CMS_ENV=development
```

## Access control

Collections share a common `environment` select field so that `development`, `test`, and `production` data can live side-by-side.
Write access requires either an authenticated Payload admin session or the `SEED_KEY` header used by the seeding scripts. Read
access for marketing content collections is public to match the previous Sanity behaviour.

## Data model

The collections mirror the content expected by `apps/web`:

- `pages` – marketing pages that embed hero data and structured content blocks
- `blog-posts` – long-form insights rendered on `/blog`
- `checkout-trust-experiences` – checkout trust modules with live metric bindings and provenance metadata
- `faqs`, `testimonials`, `case-studies`, `pricing-tiers`, `site-settings`

Rich text fields leverage the Lexical editor so seed scripts and the frontend use the same structures. The marketing kit registers hero, metrics, testimonial, product card, timeline, feature grid, media gallery, CTA cluster, and comparison table blocks so editors can compose full sections inside a single rich-text stream.

## Seeding

`tooling/scripts/seed-payload.mjs` hydrates deterministic marketing fixtures across environments. The script imports `apps/web/src/server/cms/__fixtures__/payload-lexical-marketing.json` to ensure every environment receives the same Lexical block graph, while blog posts, pricing tiers, and related collections use fixed identifiers and timestamps. Run `pnpm --filter tooling seed-payload` (or the equivalent workspace task) after configuring `PAYLOAD_URL`, `PAYLOAD_API_TOKEN`, and `SEED_KEY` to populate development, test, or production datasets.

## Preview validation

Use `tooling/scripts/validate-payload-preview.mjs` to snapshot the marketing routes against the deterministic fixtures before deploying Payload changes:

```bash
# Generate published + draft snapshots for all marketing routes
node tooling/scripts/validate-payload-preview.mjs

# Restrict validation to published pages or specific routes
node tooling/scripts/validate-payload-preview.mjs --mode=published --routes="/,/pricing"
```

The script renders `MarketingSections` with the latest Payload data and updates `apps/web/src/server/cms/__fixtures__/marketing-preview-snapshots.json`. Commit snapshot diffs with any marketing schema changes so the frontend regression tests can track block fidelity.
