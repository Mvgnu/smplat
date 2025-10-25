# SMPLaT Platform Vision

## Mission
- Deliver a premium, modern marketplace for social media growth and profile promotion services.
- Support agency operations with automation across payments, fulfillment, analytics, and bookkeeping.
- Provide trustworthy, transparent experiences for both clients and internal staff.

## Target Personas
- **Agency Admins**: Manage product catalog, pricing, fulfillment workflows, and compliance.
- **Clients**: Purchase services, manage active orders and subscriptions, track progress.
- **Finance & Operations**: Handle invoicing, Lexoffice bookkeeping, reporting, and legal compliance.

## Core Value Propositions
- Unified storefront for configurable social media growth services (e.g., Instagram promotions, follower growth).
- Post-purchase automation: API calls to fulfillment partners, notifications, order tracking.
- Self-service dashboards for clients and administrators with real-time Instagram insights.
- Built-in compliance with German bookkeeping regulations (invoice generation, Lexoffice sync).

## Success Metrics
- Conversion rate from landing page to purchase.
- Repeat purchase / subscription renewal rate.
- Order processing time and automation coverage.
- Accuracy and timeliness of bookkeeping exports.
- Customer satisfaction (NPS, support tickets).

## Guiding Principles
- **Maintainability**: Modular architecture, clean interfaces, strong typing, testing coverage.
- **Scalability**: Design for service catalog expansion, multi-channel integrations, and customer growth.
- **Security & Compliance**: GDPR adherence, secure payment flows, audit-friendly bookkeeping.
- **Usability**: Minimalist, responsive UI with clear CTAs and intuitive dashboards.
- **Observability**: Monitoring, logging, and alerting across frontend, backend, and external integrations.

## Initial Scope Highlights
- Marketing site / landing pages with clear messaging and conversion funnels.
- Authenticated client portal for order status, subscription management, metrics.
- Admin portal for product setup, order oversight, fulfillment orchestration.
- Payment processing integration (e.g., Stripe) supporting one-off and recurring billing.
- Instagram API integrations for analytics display and service execution.
- Bookkeeping automation (Lexoffice API) and invoice generation compliant with German standards.
- Notification layer for transactional emails to admins and clients.

## Constraints & Assumptions
- Frontend based on Next.js with reusable component libraries and design system.
- Backend services implemented with FastAPI, async-first, backed by PostgreSQL.
- Preference for leveraging mature third-party services (Stripe, Clerk/Auth0, SendGrid, etc.).
- Multi-stage deployment environments (dev, staging, prod) with CI/CD automation.
- Infrastructure likely on Vercel (frontend) and managed cloud (e.g., AWS/GCP) for backend (subject to validation).

## Open Questions
- Choice of fulfillment partners / APIs for executed services beyond Instagram.
- Final decision on auth provider (managed vs self-hosted).
- Detailed legal requirements for German invoicing (e.g., GoBD specifics) and retention.
- Localization needs (initially German/English?) and currency handling.
- Operational support tooling (ticketing, CRM integrations).

