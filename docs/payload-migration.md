# Payload CMS Migration Playbook

This document captures the current state of the Sanity to Payload CMS migration, the issues observed so far, and a prescriptive plan to complete the refactor. It is intended to eliminate ambiguity for anyone continuing the work.

## Background & Goals

- **Objective:** Replace the hosted Sanity CMS with a self-hostable Payload CMS instance while keeping the existing frontend (`apps/web`) fully functional.
- **Constraints:** Preserve existing data models where possible, keep the multi-environment workflow (development / test / production), ensure seeding and CI flows continue to work, and minimise disruption to the rest of the monorepo.
- **Success Criteria:**
  - Payload admin panel runs locally at `http://localhost:3000/admin` (or chosen port) using database credentials supplied in `.env`.
  - `apps/web` fetchers (`getHomepage`, `getPageBySlug`, `getBlogPosts`, `getBlogPostBySlug`) now operate against Payload by default (`cmsProvider === "payload"`).
  - Rich text/blog rendering is stable after migration from Sanity Portable Text to Payload Lexical JSON.
  - All seeds, tests, and CI automation have parity with the previous Sanity-based system.

## Current State Assessment

### Sanity Usage in `apps/web`

- `apps/web/src/server/cms` provides a provider switch (`cmsProvider`) and fetch helpers that now default to Payload while still allowing explicit Sanity fallback.
- GROQ queries (`queries.ts`) and `PortableText` rendering (`components/blog/post-content.tsx`) assume Sanity response shapes.
- Seeding and dataset management live under `tooling/scripts/seed-sanity.mjs` and `ensure-sanity-dataset.mjs`.
- Marketing routes (home, blog, product pages) depend on Sanity documents to render hero copy, sections, metrics, FAQs, testimonials, pricing tiers, and blog content.

### Payload App (`apps-cms-payload`)

- Hardened the Next.js + Payload integration. The app runs on `http://localhost:3050`, serves the admin UI at `/admin`, and exposes REST (`/api/payload/*`) plus GraphQL (`/api/graphql`).
- Key folders:
  - `src/payload.config.ts` defines collections mirroring Sanity types with a shared `environment` select field and Lexical-rich text configuration.
  - `src/collections/` hosts `pages`, `blog-posts`, `faqs`, `testimonials`, `case-studies`, `pricing-tiers`, `site-settings`, and `users`.
  - `src/access/canWrite.ts` centralises write-access rules (admin auth or `SEED_KEY` header).
- `tooling/scripts/seed-payload.mjs` creates Pages, FAQs, Case Studies, Pricing Tiers, Blog Posts, and Site Settings with environment scoping.
- The generated RSC import map (`importMap.js`) keeps Payload admin components working with Next's App Router.

### Identified Gaps

1. **Data Shape Differences:** Sanity's nested references and Portable Text differ from Payload's JSON Rich Text. Frontend serializers must be updated.
2. **Content Relationship Depth:** Payload REST calls need `depth` parameters; existing fetchers expect populated relationships.
3. **Preview & Revalidation:** ✅ Next.js preview/revalidate routes now accept provider-specific secrets. Payload webhooks ship provider headers/JSON payloads for `/api/revalidate`; configure `PAYLOAD_PREVIEW_SECRET` and `PAYLOAD_REVALIDATE_SECRET` to activate them.
4. **Studio Features:** Sanity desk structure, validations, and view customisations need Payload admin equivalents (field UI, default values, etc.).
5. **Testing Tooling:** Sanity-specific utilities (PortableText rendering, dataset ensure scripts) should be complemented or replaced with Payload tooling.
6. **Deployment:** Payload requires a PostgreSQL database and optional storage adapter. Deployment configuration (Docker, cloud) must be finalised.

### Recent Updates

- Regenerated the Payload admin import map (`apps-cms-payload/importMap.js`) and added a companion `importMap.d.ts` so typechecking passes while the map stays as a checked-in artifact. The admin route now feeds `RootPage` the expected `config` promise and import map reference.
- Verified `pnpm --filter @smplat/cms-payload typecheck` and `pnpm --filter @smplat/cms-payload lint` succeed; lint still reports upstream TypeScript peer warnings that should be documented before release.
- Added Jest coverage for `apps/web/src/components/blog/post-content.tsx` to exercise headings, lists, and links rendered from Payload Lexical JSON. The suite now consumes the React renderer (mocked in unit tests for determinism) so the marketing app exercises the same component tree Payload ships.
- Blog, pricing, and campaigns routes in `apps/web` now resolve through the shared `MarketingSections` Lexical renderer, ensuring every marketing surface consumes the normalized Payload block taxonomy instead of bespoke JSX implementations.
- Payload seed script now imports the shared Lexical marketing fixture (`apps/web/src/server/cms/__fixtures__/payload-lexical-marketing.json`) so every environment renders identical marketing previews with stable timestamps and identifiers.

## Migration Plan

### Phase 1 – Payload Backend Hardening

1. **Schema Audit & Alignment**
   - Verify each collection in `src/collections` contains all fields used by `apps/web`. Pay particular attention to `content` blocks and nested relationships.
   - Ensure unique constraints (`slug`, etc.) match Sanity expectations.
   - Add required admin UI configuration (labels, default sort, field descriptions) to ease editorial use.

2. **Environment Support**
   - Confirm the `environment` select field is present on every tenant-specific collection.
   - Update `seed-payload.mjs` to accept explicit environment arguments (already supported) and validate recorded IDs.

3. **Access Control**
   - Finalise `canWrite` access helper to allow authenticated users or seed requests (via `SEED_KEY` header).
   - Configure admin user collection with appropriate auth options (password policies, session durations).

4. **Import Map & Admin Assets**
   - Run `pnpm --filter apps-cms-payload generate:importmap` after schema changes to keep admin RSC bindings up to date.
   - Commit the generated `importMap.js` to ensure consistent deployments.

5. **Database & Storage**
   - Decide whether to keep plain Postgres or introduce a storage adapter (S3, local disk) for media.
   - Document `.env` expectations (`DATABASE_URI`, `PAYLOAD_SECRET`, optional `PAYLOAD_URL`, etc.).

### Phase 2 – Integrate Payload with `apps/web`

1. **Client Wrapper Enhancements**
   - Extend `apps/web/src/server/cms/client.ts` to support POST/PATCH requests against Payload for revalidation hooks.
   - Add error handling and logging parity with Sanity client.

2. **Loaders Rewrite**
   - Update `getHomepage`, `getPageBySlug`, `getBlogPosts`, `getBlogPostBySlug` to:
     - Request the necessary relationship depth (`depth=2` or more as needed).
     - Map Payload document shapes into the existing Zod schemas (adapt schemas if required).
     - Exercise draft previews in Jest by seeding fixtures with nested relationship graphs (blog posts, metrics, testimonials)
       and asserting the loader output preserves those shapes when `draftMode` is enabled (`apps/web/src/server/cms/__tests__/payload-loaders.test.ts`).
   - If Lexical Rich Text is returned, create converters to the existing `PageSection` structures (e.g., convert Lexical JSON to React components, or store as plain text/HTML).

3. **Rich Text Rendering**
   - Replace `PortableText` usage with a Payload-compatible renderer.
   - Options:
     1. Build a Lexical → React renderer leveraging `@payloadcms/richtext-lexical/client`.
     2. Store a simplified HTML or markdown representation when seeding/migrating.
   - Ensure blog posts render body content identically to the Sanity version.

4. **Mutation & Revalidation Hooks**
   - ✅ Payload collections now ship `afterChange`/`afterDelete` hooks that POST to `/api/revalidate` using `x-payload-signature` and `x-cms-provider` headers plus generated `requestId`s for traceability.
   - ✅ `/app/api/revalidate/route.ts` validates Payload and Sanity signatures, maps marketing/blog paths, enforces environment scoping, and emits structured logs/metrics.
   - Support on-demand revalidation via Payload admin actions (optional but recommended).

5. **Preview Mode**
   - ✅ Draft mode now appends `draft=true` and `x-payload-preview` headers so unpublished entries render via preview URLs.
   - Update Payload admin preview buttons to point at `/api/preview` with the Payload secret and relative redirect paths.

6. **CMS Provider Switch**
   - ✅ Default runtime now resolves to Payload unless `CMS_PROVIDER=sanity` is explicitly set.
   - Document fallback to Sanity (if still needed temporarily) and target removal timeline.

### Phase 3 – Data Migration & Verification

1. **Migration Script**
   - Write a one-time migration script to fetch Sanity datasets and insert into Payload (via REST or Node API).
   - Handle mapping for references, slugs, and Portable Text to Lexical conversions.

2. **Content Parity Testing**
   - Compare Sanity and Payload outputs for key pages (home, blog posts, product pages).
   - Maintain a fixture set in `tests/` that ensures required fields are present.

3. **Automated Tests**
   - Add integration tests targeting Payload REST responses (use Vitest with `getPayload`).
   - Update Playwright smoke tests to log in to the Payload admin and verify key collections render.

4. **Performance Checks**
   - Evaluate query performance with depth > 1; optimise by defining `defaultDepth` and using Payload GraphQL where helpful.

### Phase 4 – Deployment & Ops

1. **Docker & Compose**
   - Update `docker-compose.yml` (root or app-specific) to run Payload + Postgres locally.
   - Ensure health checks, ports, and volumes align with app expectations.

2. **CI Pipeline**
   - Add `pnpm --filter apps-cms-payload lint`, `build`, and `test:int` to CI.
   - Run seeds in CI (`pnpm payload:seed:test`) to validate migrations.

3. **Production Configuration**
   - Choose deployment target (e.g., Vercel for Next frontends + separate server, or self-hosted Node).
   - Document required environment variables, secrets rotation, and backup strategy for Postgres.

4. **Monitoring**
   - Enable Payload logs/metrics (pino configuration, request logging).
   - Integrate with existing observability stack (if any) for request latency and error tracking.

## Deliverables Checklist

- [ ] Payload collections aligned with Sanity data requirements.
- [ ] `importMap.js` checked in and regenerated after schema changes.
- [ ] `apps/web` loaders and components compatible with Payload responses.
- [ ] Webhook/revalidation integration in place with structured logging/metrics.
- [ ] Migration script executed (with documented steps and rollback plan).
- [ ] CI pipeline updated to include Payload lint/build/test/seeding.
- [ ] Deployment guide for Payload (local dev + production).
- [ ] Sanity dependencies deprecated and removed once Payload is live.

## Open Questions / Decisions Needed

1. **Rich Text Strategy:** Final decision on how to render Payload Lexical data in Next.js (custom renderer vs. stored HTML).
2. **Dual CMS Support:** Confirm whether temporary dual-support is required or if we can fully switch to Payload after migration.
3. **Auth & Roles:** Determine if Payload needs additional role-based access controls beyond default admin users.
4. **Media Storage:** Decide on local vs. cloud storage adapters for the `Media` collection.
5. **Preview/Live Editing:** Clarify requirements for live preview or inline editing equivalent to Sanity Studio features.

## Reference Commands

```bash
# Start Payload admin (handles Next + API routes)
pnpm --filter apps-cms-payload dev

# Regenerate import map after modifying collections or editor config
pnpm --filter apps-cms-payload generate:importmap

# Regenerate TS types
pnpm --filter apps-cms-payload generate:types

# Seed Payload data (development environment)
pnpm payload:seed:dev

# Run Payload integration tests
pnpm --filter apps-cms-payload test:int
```

## Next Immediate Actions

1. Validate the current Payload admin UI by authenticating and confirming collections appear as expected.
2. Begin adapting `apps/web` fetchers to accept Payload payloads (start with `getHomepage` and `getBlogPosts`).
3. Plan the content migration script with a dry-run against development datasets.
4. Draft revalidation webhook flow using Payload hooks and update frontend route accordingly.

## Sanity Sunset Timeline

| Milestone | Target Date | Criteria |
| --- | --- | --- |
| Preview parity | +1 sprint | Payload preview confirmed with unpublished content and documented admin button setup. |
| Revalidation go-live | +2 sprints | Payload webhooks active in production, monitoring dashboards populated with preview/revalidation metrics. |
| Sanity fallback off | +3 sprints | `CMS_PROVIDER` defaults removed from deployment manifests; Sanity secrets rotated out of `.env` files. |
| Sanity removal | +4 sprints | GROQ queries and PortableText renderer deleted; Sanity packages removed from `package.json`. |

Rollback criteria: if Payload preview/revalidation emit more than three consecutive `revalidation denied` errors or draft content fails to load for priority pages, pause the sunset and reinstate `CMS_PROVIDER=sanity` until issues are resolved.

---

This document should be updated as progress continues. Treat it as the authoritative guide for the Sanity → Payload conversion workstream.
