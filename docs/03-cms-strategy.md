# CMS Strategy & Integration Plan

## Decision
- **Primary CMS**: Sanity.io (self-hosted content studio option + managed API).
- **Rationale**:
  - Excellent Next.js integration via Sanity SDK and GROQ queries with ISR/SSG support.
  - Real-time collaborative editing fits agency marketing workflows.
  - Flexible content modeling supports multilingual landing pages, product storytelling, blog.
  - Portable Text and image pipeline for rich content while maintaining performance budgets.
  - Strong developer tooling, CLI, and studio customization to align with brand identity.
  - Data residency compliant with EU infrastructure tiers; export tools for compliance.

## Usage Scope
- Marketing/landing content (hero, service sections, testimonials, FAQs, case studies).
- Blog articles, resources, and SEO metadata.
- Home-page experiments and campaign-specific landing pages.
- Potentially product storytelling metadata (non-transactional attributes).

## Architecture Integration
- Sanity dataset: `production` (with `staging` dataset for preview flows).
- Next.js leverages Sanity client in server components; incremental static regeneration for high-traffic pages, fallback to on-demand revalidation via webhooks.
- Preview mode wired through Next.js draft content support; authenticated editors preview updates instantly.
- Content cache layer via Sanity's CDN + Next.js caching headers.
- Webhooks configured for document publish → trigger Vercel revalidation endpoints.
- See `docs/13-sanity-webhooks.md` for detailed webhook/preview configuration.

## Security & Compliance
- Role-based editor permissions mapped to Sanity roles; integrate with SSO (Google Workspace) for internal staff.
- Scheduled exports & backups stored in S3 for audit readiness.
- Content version history retained for legal compliance; integrate with change review workflow.
- GDPR/DSGVO review: ensure privacy policy content managed centrally; cookie consent copy maintained via CMS.

## Implementation Tasks
1. Provision Sanity project, datasets, and service accounts.
2. Scaffold Sanity Studio within monorepo (`apps/cms`); configure design tokens, brand theme. ✅ (baseline config & schemas)
3. Model schemas: `page`, `section`, `testimonial`, `faq`, `blogPost`, `category`, `seo`. (partial ✅ for page/section/testimonial/site settings/faq/caseStudy/blogPost/pricingTier)
4. Implement Next.js data fetching utilities with typed GROQ queries (Zod validation). ✅ (`apps/web/src/server/cms/*`, updated for metrics/FAQ/case study/pricing/blog)
5. Stand up marketing routes for blog/pricing. ✅ (`apps/web/src/app/(marketing)/blog/page.tsx` and homepage sections)
5. Configure preview routes and webhook endpoints (`/api/revalidate`). ✅ (`apps/web/src/app/api/preview`, `/api/revalidate`)
6. Document editorial workflows, training materials, and governance policy (seed workflow documented in `docs/12-content-seeding.md`).
