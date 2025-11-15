# Architecture Foundation

## System Overview
- **Frontend**: Next.js 14 (App Router) with TypeScript, leveraging server components, React Server Actions, and edge-friendly routes. Deployed on Vercel. Integrate a design system (e.g., Tailwind + Radix UI + shadcn/ui) for rapid development of marketing pages, product catalog, and dashboards.
- **Backend**: FastAPI (Python 3.12) providing REST and background task APIs. Structured as modular services (auth, catalog, orders, billing, integrations) with async execution via `asyncio`/`httpx`.
- **Database**: PostgreSQL (managed service such as Neon or Supabase) surfaced through FastAPI (SQLAlchemy 2.0 + Alembic); frontend consumes REST/JSON APIs without a direct ORM.
- **Queue / Task Processing**: Redis-backed Celery or Dramatiq workers for long-running tasks—API fulfillment, Instagram data syncing, invoicing, email dispatch.
- **File Storage**: S3-compatible storage (AWS S3 or compatible provider) for invoice PDFs, exports, and media.
- **Authentication & Authorization**: Self-managed Auth.js (NextAuth) deployment with OAuth/OpenID Connect providers (Google, Facebook, Instagram) and email/password flows; session tokens persisted in Postgres, backend verifies via JWT/session introspection. RBAC roles (`client`, `admin`, `finance`).
- **Payments & Billing**: Stripe for checkout, recurring subscriptions, invoicing; integrate webhooks to trigger order creation and FastAPI workflows.
- **Bookkeeping**: Lexoffice API integration through backend service with OAuth2; schedule sync jobs for invoices, payments, customer records.
- **Observability**: Logging via structured JSON logs (Loguru/structlog), monitoring with Sentry (frontend/backend) and Prometheus-compatible metrics (FastAPI instrumented).
- **Email Delivery**: Self-managed SMTP relay (Postal/Mailu) with adapter for Resend/Cloudflare Mail; shared template pipeline for transactional emails (auth verification, orders, invoices).

## Service Boundaries
- **Marketing & Storefront** (Next.js): Landing content, product pages, blog, SEO, lead capture.
- **Client Portal** (Next.js + API): Dashboard, active orders, subscription details, analytics visualizations, support messaging.
- **Admin Portal** (Next.js + API): Catalog management, pricing, fulfillment oversight, manual interventions, analytics, finance tools.
- **Core API** (FastAPI):
  - `auth`: identity sync, session verification, role enforcement.
  - `catalog`: products, plans, configurable options, bundling.
  - `orders`: shopping cart, checkout, post-payment orchestration, status tracking.
  - `billing`: Stripe webhook handling, invoice generation, Lexoffice syncing.
  - `analytics`: Instagram data ingestion, caching, and exposure via API endpoints.
  - `notifications`: email scheduling, templating, delivery tracking.
  - `compliance`: audit logs, GDPR tooling, data retention workflows.

## Data Flow Highlights
1. **Checkout Flow**: Client selects product ➜ Stripe Checkout ➜ Webhook hits FastAPI ➜ Create Order + Payment records ➜ Enqueue fulfillment tasks ➜ Send confirmation emails ➜ Update dashboards.
2. **Instagram Analytics**: Scheduled workers pull metrics via Instagram Graph API ➜ Store snapshots in PostgreSQL ➜ Expose aggregated views to Next.js dashboards via API ➜ Display charts with caching (React Query / RSC).
3. **Bookkeeping**: On invoice creation or payment capture ➜ Generate compliant PDF ➜ Push to Lexoffice ➜ Store references in finance tables ➜ Notify finance role.
4. **Subscription Lifecycle**: Stripe events trigger backend updates (renewal, cancellation, payment failure) ➜ Update client portal states ➜ Send notifications ➜ Adjust fulfillment schedules.

## Deployment & DevOps
- **Environments**: `dev`, `staging`, `prod` with environment-specific configuration and secrets management (e.g., Doppler, Vault, or Vercel/Cloud secrets).
- **CI/CD**: GitHub Actions pipelines running linting, type-checking (TypeScript, mypy), unit/integration tests, and automated deploys on protected branches.
- **Infrastructure as Code**: Terraform or Pulumi to define backend infrastructure (APIs, DB, Redis, S3, secrets, networking).
- **API Documentation**: FastAPI auto docs (OpenAPI) with dedicated docs portal; maintain typed clients via code generation (e.g., openapi-typescript).

## Tech Stack Decisions
- **Frontend**
  - TypeScript strict mode, ESLint, Prettier, Jest/Testing Library, Playwright for E2E.
  - TanStack Query for data synchronization, Zod for schema validation.
  - Storybook for component documentation (optional but recommended).
  - CSS: Tailwind CSS with custom theme; use Radix primitives for accessibility.
- **Backend**
  - Python 3.12, FastAPI, Pydantic v2 for schema definitions.
  - SQLAlchemy 2.x ORM with async engine, Alembic migrations.
  - Celery (with Redis) for async tasks; Flower or similar for monitoring.
  - PyTest for unit/integration tests, coverage thresholds enforced.
- **Shared**
  - Git Hooks via Husky/pre-commit for linting and formatting.
  - Conventional Commits for changelog automation.
  - Sentry for error tracking; Datadog or Grafana Cloud for metrics/log aggregation.

## Security Considerations
- Enforce HTTPS everywhere; configure HSTS and CSP headers.
- Secret rotation policies for Stripe, Lexoffice, Instagram, email provider.
- Role-based access checks in FastAPI routers and Next.js server actions.
- Data encryption at rest (managed Postgres, S3 SSE) and in transit (TLS).
- Audit logging for admin actions and data exports.

## Scalability & Extensibility
- Adopt modular monorepo structure (e.g., Turborepo) to host frontend, backend, shared libs.
- Feature flag system (e.g., LaunchDarkly or open-source alternatives) for gradual rollouts.
- Plugin-style integration layer to add future social networks or service providers with minimal changes.
