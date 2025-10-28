# Implementation Roadmap - Phase 1 Execution

## Overview
This document outlines the immediate implementation plan to transform SMPLAT from a platform framework into a fully functional first-party social media services provider.

## Current State Analysis
- ✅ Monorepo structure with Next.js frontend and FastAPI backend
- ✅ Basic product catalog admin interface
- ✅ Database models for core commerce entities
- ✅ Authentication foundation with Auth.js
- ❌ Customer-facing storefront missing
- ❌ Payment processing not integrated
- ❌ Service fulfillment automation absent
- ❌ Client dashboard and tracking missing

## Critical Path Implementation

### Phase 1A: Core E-commerce Foundation (Week 1-2)
**Priority: CRITICAL**

#### 1. Customer-Facing Storefront
- **Files**: `apps/web/src/app/(storefront)/`
- **Components**: Product catalog, service detail pages, pricing display
- **Features**: 
  - Service package browsing with configurable options
  - Clear pricing and delivery timelines
  - Service comparison and recommendations
  - Mobile-responsive design
- **Status**: Product listing, configurable service detail, persistent cart, and checkout funnel live; product detail marketing pulls from Sanity page documents; saved configurations, price breakdown ledger, CMS-backed media galleries, catalog sort options, and bundle recommendations now in place. Next up: merch analytics experiments and deeper CMS-driven landing controls.
- **Status**: Product listing, configurable service detail, persistent cart, and checkout funnel live; product detail marketing pulls from Sanity page documents; saved configurations, price breakdown ledger, CMS-backed media galleries, catalog sort options, bundle recommendations, and a CMS-managed checkout trust layer with concierge entry points and dynamic delivery timelines are now in place. Next up: merch analytics experiments and deeper CMS-driven landing controls.
- **Observability**: `/api/v1/observability/catalog-search` captures search/filter/sort usage to inform merchandising decisions.

#### 2. Stripe Payment Integration
- **Files**: `apps/api/src/smplat_api/services/payments/`
- **Components**: Checkout sessions, webhook handling, payment tracking
- **Features**:
  - Secure checkout flow with Stripe Checkout
  - Support for one-time and subscription billing
  - Webhook event processing for order creation
  - Payment failure handling and retry logic
- **Status**: Checkout session initiation, payment persistence, fulfillment hand-off, and frontend checkout orchestration implemented; webhook idempotency logging plus delivery/retry instrumentation live; API access protected via internal key; hosted checkout sessions now persist to Postgres for invoice linkage; remaining work focuses on production monitoring hooks, lifecycle transitions, and failure analytics.
- **Observability**: `/api/v1/payments/observability` (secured via checkout API key) exposes checkout + webhook success/failure counters and recent failure metadata for dashboards and alert rules.

#### 3. Order Processing Pipeline
- **Files**: `apps/api/src/smplat_api/services/orders/`
- **Components**: Order creation, status management, notification triggers
- **Features**:
  - Automatic order creation from successful payments
  - Order status workflow (pending → processing → active → completed)
  - Integration with fulfillment queue
  - Customer notification triggers
- **Status**: Order API supports creation/listing and now applies automated status transitions based on fulfillment task lifecycle; progress snapshots are exposed via `/api/v1/orders/{id}/progress`. Notification hooks remain open.

### Phase 1B: Service Fulfillment Engine (Week 2-3)
**Priority: HIGH**

#### 4. Instagram API Integration
- **Files**: `apps/api/src/smplat_api/integrations/instagram/`
- **Components**: Graph API client, account verification, metrics collection
- **Features**:
  - Instagram Business Account linking
  - Real-time metrics retrieval (followers, engagement, reach)
  - Account verification and validation
  - Rate limiting and error handling

#### 5. Fulfillment Automation System
- **Files**: `apps/api/src/smplat_api/services/fulfillment/`
- **Components**: Task queue, service delivery workers, progress tracking
- **Features**:
  - Automated service initiation based on order details
  - Progress tracking with milestone updates
  - Service completion detection and notification
  - Quality assurance and delivery validation
- **Status**: Fulfillment task processor loop implemented with metrics, exponential backoff retries, and dead-letter accounting; staging toggles and external alerting/observability wiring still outstanding.
- **Observability**: `/api/v1/fulfillment/observability` aggregates processed/failed/retry/dead-letter counts per task type, enabling dashboards and alert rules (see `docs/18-fulfillment-observability.md`).

#### 6. Email Notification System
- **Files**: `apps/api/src/smplat_api/services/notifications/`
- **Components**: Template engine, delivery tracking, preference management
- **Features**:
  - Transactional email templates (order confirmation, progress updates)
  - Customer preference management
  - Delivery tracking and retry logic
  - Multi-language support
- **Status**: SMTP-backed notification service now ships Markdown/HTML templates for payment receipts, fulfillment retries/completion, and weekly digests. Preferences gate each channel, and the cron-friendly dispatcher (`tooling/scripts/run_weekly_digest.py`) queues weekly digests via the same NotificationService. Outstanding work focuses on template localization and optional multi-channel delivery.

### Phase 1C: Client Experience Platform (Week 3-4)
**Priority: MEDIUM**

#### 7. Client Dashboard
- **Files**: `apps/web/src/app/(client)/`
- **Components**: Order tracking, service progress, analytics visualization
- **Features**:
  - Real-time service progress monitoring
  - Instagram metrics dashboard with charts
  - Order history and billing management
  - Service performance analytics
- **Status**: Client workspace now preloads assigned orders, persists the last selection per account, and surfaces Instagram analytics plus notification toggles (wired to backend opt-outs) alongside fulfillment progress. Upcoming work: richer campaign analytics and billing/reporting widgets.

#### 8. Enhanced Order Management
- **Files**: `apps/web/src/app/(admin)/orders/`
- **Components**: Order oversight, manual interventions, customer communication
- **Features**:
- Comprehensive order pipeline view
- Manual fulfillment controls and overrides
- Customer communication tools
- Revenue and performance analytics

### Phase 1D: Revenue-Driven Experience & Trust Layer (Week 4-6)
**Priority: HIGH**

#### 9. Confidence-Centric Checkout
- **Files**: `apps/web/src/app/(storefront)/checkout/`, `apps/web/src/components/storefront/checkout/`, `apps/api/src/smplat_api/services/checkout/`
- **Components**: Assurance badges, satisfaction guarantees, transparent pricing timelines, live support entry points
- **Features**:
  - Display audited trust signals (secure payment badges, guarantee copy, refund SLA) sourced from CMS with feature flags for rapid iteration
  - Inline delivery timeline widget tied to selected package configuration and fulfillment backlog metrics
  - Persistent support CTA (chat/email callback) with contextual payload (cart contents, workspace intent)
  - Checkout recap that highlights add-on value (priority support, onboarding concierge)
- **Status**: Pending; requires CMS schema additions for assurance messaging, Next.js component work, and backend service hints for dynamic delivery estimates.
- **Status**: In progress. Checkout now consumes the new `checkout-trust-experiences` CMS collection, resolves fulfillment metrics via `/api/v1/trust/experiences`, and surfaces provenance-aware badges plus staleness warnings. Remaining scope: dynamic delivery estimates tied to backlog data and richer support CTAs.

#### 10. Dynamic Bundles & Targeted Upsells
- **Files**: `apps/web/src/app/(storefront)/products/[slug]/`, `apps/web/src/components/storefront/bundles/`, `apps/api/src/smplat_api/services/catalog/recommendations.py`
- **Components**: Bundle composer, limited-time offers ribbon, personalized upsell modal
- **Features**:
  - Generate contextual bundles (e.g., "Instagram Growth + Content Studio") based on cart composition and CMS-configured campaigns
  - Surface post-add-to-cart upsell modal with quantified ROI and testimonial snippets
  - Track offer impressions/acceptance via lightweight analytics stored in Postgres for merchandising review (no third-party telemetry spam)
  - Allow operations to schedule seasonal offers via CMS toggles with automatic expiry
- **Status**: Pending; requires recommendation service, CMS authoring fields, and storefront UI hooks.

#### 11. Post-Purchase Onboarding Journey
- **Files**: `apps/api/src/smplat_api/services/orders/onboarding.py`, `apps/api/src/smplat_api/api/v1/endpoints/onboarding.py`, `apps/web/src/app/(storefront)/checkout/success/page.tsx`, `apps/web/src/app/(client)/dashboard/page.tsx`, `apps/web/src/server/onboarding/journeys.ts`
- **Components**: Welcome checklist, trust-building video modal, resource locker, referral nudge
- **Features**:
  - Immediately after checkout success, the journey service hydrates durable tasks, referral codes, and contextual metadata which the success page renders live.
  - Embed proof-driven content (case study highlights, before/after metrics) and satisfaction guarantees to reinforce buying confidence.
  - Offer loyalty incentives (referral codes, upgrade coupons) once onboarding checklist hits key milestones with referral events persisted server-side for operator review.
  - Persist onboarding state for operators with dashboard visibility; Slack/email nudges reuse notification services next.
- **Status**: Operator command center is live at `/admin/onboarding` with journey filters, risk scoring, artifact visibility, manual nudge rails, and automated idle-task detection (cronable via `tooling/scripts/onboarding_nudges.py`). Remaining scope: concierge playbooks for social proof hand-offs and richer referral analytics.

#### 12. Social Proof & Community Layer
- **Files**: `apps/web/src/app/(storefront)/products/[slug]/`, `apps/web/src/components/storefront/testimonials/`, `apps/api/src/smplat_api/services/content/case_studies.py`
- **Components**: Rotating testimonial carousel, verified results gallery, community AMA scheduling block
- **Features**:
  - Feed storefront sections with CMS-tagged testimonial collections segmented by industry/goal
  - Allow prospects to RSVP for live onboarding webinars or AMAs directly from the product page
  - Publish anonymized performance snapshots (e.g., follower growth curves) generated from fulfilled orders with client consent
  - Integrate trust badges (payment protection, compliance statements) maintained centrally in CMS and shared across storefront + checkout
- **Status**: Pending; requires CMS collection definitions, frontend components, and opt-in data aggregation from fulfillment outcomes.

## Technical Implementation Standards

### Code Quality Requirements
- **TypeScript**: Strict mode enabled, comprehensive type coverage
- **Testing**: Unit tests for all services, integration tests for critical paths
- **Documentation**: JSDoc for all public APIs, README for each module
- **Error Handling**: Comprehensive error boundaries and logging
- **Security**: Input validation, SQL injection prevention, rate limiting

### Enterprise Readiness Features
- **Monitoring**: Health checks, metrics collection, alerting
- **Scalability**: Database indexing, caching strategies, async processing
- **Compliance**: GDPR compliance, audit logging, data retention policies
- **Deployment**: Environment-specific configurations, CI/CD integration
- **Backup**: Database backups, disaster recovery procedures

### Database Migrations Required
1. Add missing indexes for performance optimization
2. ✅ Create fulfillment task and tracking tables (`20251015_04_fulfillment_tables`)
3. Add notification preferences and delivery tracking
4. Implement audit log tables for compliance

### Environment Variables Setup
```bash
# Stripe Configuration
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Instagram API
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_GRAPH_API_VERSION=v18.0

# Email Service
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...

# Service Configuration
SERVICE_FULFILLMENT_ENABLED=true
ANALYTICS_REFRESH_INTERVAL=3600

# Fulfillment Worker
FULFILLMENT_WORKER_ENABLED=false
FULFILLMENT_POLL_INTERVAL_SECONDS=30
FULFILLMENT_BATCH_SIZE=25

# Weekly Digest Scheduler
WEEKLY_DIGEST_ENABLED=false
WEEKLY_DIGEST_INTERVAL_SECONDS=604800
WEEKLY_DIGEST_DRY_RUN=true
```

## Success Metrics

### Technical KPIs
- Page load times < 2 seconds
- API response times < 500ms
- 99.9% uptime
- Zero security vulnerabilities
- 100% test coverage for critical paths

### Business KPIs
- Payment success rate > 98%
- Service delivery completion rate > 95%
- Customer satisfaction score > 4.5/5
- Order processing time < 5 minutes
- Support ticket volume < 5% of orders

## Risk Mitigation

### Technical Risks
- **Instagram API limits**: Implement caching and rate limiting
- **Payment processing failures**: Comprehensive webhook handling and retry logic
- **Database performance**: Proper indexing and query optimization
- **Service delivery delays**: Monitoring and automated fallback procedures

### Business Risks
- **Customer acquisition**: Clear onboarding and value proposition
- **Service quality**: Quality assurance checks and performance monitoring
- **Competition**: Unique value proposition and superior user experience
- **Regulatory compliance**: Legal review and compliance automation

## Next Steps
1. Ship assurance-rich checkout enhancements with CMS-managed trust copy and dynamic delivery timelines.
2. Launch dynamic bundles and contextual upsells wired into catalog services and storefront UI.
3. Build the post-purchase onboarding journey with operator + customer visibility.
4. Stand up social proof surfaces (testimonials, verified results, live events) across storefront touchpoints.
5. Backfill supporting analytics (offer acceptance, onboarding completion) with lean Postgres reporting tables and update runbooks.

This roadmap ensures systematic delivery of a production-ready social media services platform with enterprise-grade quality and comprehensive documentation.
