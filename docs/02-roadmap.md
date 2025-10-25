# Roadmap & Execution Plan

## Phase 0 – Foundations (Weeks 0-2)
- ✅ Define brand identity, design system tokens, UI kit.
- ✅ Set up monorepo (Turborepo) with Next.js app, FastAPI service, shared packages.
- Configure CI/CD pipelines, linting, formatting, testing harnesses.
- ✅ Establish environment management (secrets, `.env`, Terraform skeleton).
- ✅ Integrate authentication provider skeleton; user role model defined.
- Stand up baseline database schema (users, customer profiles, notifications ✅; remaining commerce tables pending).

## Phase 1 – Storefront & Catalog (Weeks 3-6)
- Marketing site with hero, services overview, testimonials, FAQs, blog scaffolding. (Home hero + metrics/FAQ/pricing/case study now sourced from Payload by default; Sanity remains available for fallback only.)
- Product catalog API and service layer established for CRUD via FastAPI, with admin UI for creation/update/delete in Next.js.
- Product catalog pages with configurable options, pricing tiers, localization-ready content.
- CMS integration (Payload as the primary provider, with temporary Sanity fallback) for marketing content and testimonials.
- Implement checkout flow with Stripe Checkout (one-time + subscription SKUs).
- GDPR-compliant cookie consent, privacy policy, legal pages.
- Analytics instrumentation (GA4, privacy-compliant tracking, conversion events).

## Phase 2 – Client Portal (Weeks 6-10)
- Authenticated dashboard with order summary, subscription status, invoices.
- Order detail pages displaying fulfillment steps and timelines.
- Integrate Instagram API data visualizations (metrics cards, charts).
- Implement support ticket/messages module and knowledge base integration.
- Notification preferences, email templates, real-time updates (Pusher/WebSockets optional).

## Phase 3 – Admin Portal & Operations (Weeks 8-12)
- Admin dashboard for service management, pricing, discount codes.
- Order queue with status management, fulfillment actions, retry flows.
- Automation rules configuration (API triggers, manual override tooling).
- Finance console for invoice review, Lexoffice sync logs, reconciliation reports.
- Audit log viewer, GDPR tooling (data export/delete).

## Phase 4 – Automation & Compliance (Weeks 10-14)
- Stripe webhook robustness (retries, idempotency keys, monitoring).
- Invoice PDF generation (templated, localized, VAT handling).
- Lexoffice integration (OAuth flow, push invoices, fetch payment statuses).
- Background workers for Instagram data refresh, invoice dispatch, reminders.
- Penetration testing, security review, disaster recovery playbook.

## Phase 5 – Launch Readiness (Weeks 12-16)
- Load testing, performance tuning, SEO polish, accessibility audit (WCAG 2.1 AA).
- Content finalization, localization (DE/EN), marketing automation sequences.
- Run pilot onboarding with beta clients, gather feedback, iterate.
- Support team training, knowledge base completion, incident response drills.
- Formal go-live checklist, production release, post-launch monitoring.

## Workstream Ownership
- **Product & Design**: Requirements refinement, UX/UI, content strategy, roadmap adjustments.
- **Frontend Engineering**: Next.js implementation, component library, dashboards, analytics.
- **Backend Engineering**: FastAPI services, integrations, background workers, compliance modules.
- **DevOps/SRE**: CI/CD, infrastructure, observability, security hardening, incident response.
- **Finance & Operations**: Lexoffice coordination, invoicing policies, bookkeeping workflows.

## Key Deliverables & Milestones
- M0: Monorepo & CI running tests and linting on main.
- M1: Checkout live in staging with Stripe test mode.
- M2: Client portal MVP with Instagram data mock.
- M3: Admin portal managing real orders in staging.
- M4: Lexoffice sync proven end-to-end with sample invoices.
- Launch: Production deployment with real payments enabled.

## Risk Register (Initial)
- **Instagram API limits**: Rate limiting or data gaps; mitigation: caching, fallbacks, partner APIs.
- **Compliance complexity**: German regulations evolving; mitigation: consult accountant, automated audit logs.
- **Integration dependencies**: Stripe/Lexoffice downtime; mitigation: retry/backoff, status monitoring.
- **Scalability pressure**: Rapid growth; mitigation: auto-scaling infrastructure, efficient queries, SLOs.
- **Resource bandwidth**: Cross-functional coordination; mitigation: weekly steering meetings, Kanban visibility.

## Immediate Next Actions
1. Enable the fulfillment worker in staging, wire metrics to observability, and codify alert thresholds for loop errors and dead-letter growth.
2. Stand up Stripe checkout/webhook dashboards plus alerting using the new delivery/retry metadata; integrate smoke scripts into CI for regression coverage.
3. Layer merchandising analytics + CMS-driven experiment toggles (bundle performance dashboards, additional `product-<slug>` pages, and search telemetry feeding product decisions).
