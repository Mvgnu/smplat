# CMS Strategy & Integration Plan

## Decision
- **Primary CMS**: Payload CMS (self-hosted via `apps-cms-payload`).
- **Fallback window**: Sanity Studio (`apps/cms`) remains available for teams that still depend on legacy workflows. Enable it by setting `CMS_PROVIDER=sanity` and populating the Sanity environment variables until the remaining parity tasks in `docs/payload-migration.md` are complete.

## Rationale
- Payload runs entirely within our infrastructure, aligning with platform self-hosting goals and simplifying compliance reviews.
- The Payload admin UI (Next.js) matches the component model used in `apps/web`, easing shared component reuse.
- Built-in TypeScript schema generation and REST/GraphQL APIs accelerate typed data access.
- Rich text is stored as Lexical JSON which maps directly to the renderers already landing in the marketing app.
- Sanity stays available only as a temporary fallback for teams who have not yet migrated specific content types or workflows.

## Usage Scope
- Marketing and landing content (hero, service sections, testimonials, FAQs, case studies).
- Blog articles, resources, and SEO metadata.
- Home-page experiments and campaign-specific landing pages.
- Product storytelling metadata and other marketing-only enrichments alongside transactional data.

## Architecture Integration
- `apps-cms-payload` hosts the Payload admin UI at `http://localhost:3050/admin` and APIs at `/api/payload/*` and `/api/graphql`.
- `apps/web` fetchers default to Payload via `cmsProvider === "payload"`; they only call Sanity utilities when `CMS_PROVIDER=sanity` is explicitly configured.
- Local development seeds Payload with `pnpm payload:seed:dev`; tests target `payload:seed:test` so fixtures remain deterministic.
- Incremental static regeneration and previews will be migrated to Payload-first webhooks. Sanity webhooks remain functional during the fallback window but are slated for removal once replacements ship.

## Security & Compliance
- Payload collections share an `environment` select field to scope development, test, and production data in a single database.
- Admin authentication is handled by Payload; seed scripts provision baseline admin users and can rotate credentials via env vars.
- REST APIs expose marketing content publicly to mirror Sanity's CDN behaviour while mutations require authenticated admin sessions or the seeded service key.
- Sanity datasets should only store redacted copies of marketing content while the fallback is active; schedule deletion once the migration checklist closes.

## Implementation Tasks
1. Harden Payload collections, access control, and seed data to cover every storefront dependency.
2. Expand Payload-specific loaders, fixtures, and tests (`apps/web/src/server/cms`) beyond the homepage to blogs and pages.
3. Replace Sanity preview and revalidation logic with Payload-native equivalents in the Next.js API routes.
4. Audit admin UX parity (blocks, validations, default values) and update Payload schemas accordingly.
5. Deprecate unused Sanity utilities, rendering helpers, and dependencies once verification completes.
6. Document migration progress in `docs/payload-migration.md` and schedule the final Sanity shutdown milestone.

Sanity-specific docs (e.g., `docs/12-content-seeding.md`, `docs/13-sanity-webhooks.md`) remain for the fallback window. Add deprecation notes there as parity lands and remove them when the window closes.
