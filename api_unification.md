# API Unification Report

## Background

- The production backend (`apps/api`) exposes a comprehensive FastAPI surface covering catalog, checkout, billing, loyalty, onboarding, instagram analytics, trust content, observability, and authentication telemetry (`apps/api/src/smplat_api/api/v1/endpoints`). Key examples include order CRUD and listing (`apps/api/src/smplat_api/api/v1/endpoints/orders.py:217`), loyalty tier/member operations (`apps/api/src/smplat_api/api/v1/endpoints/loyalty.py:409`), checkout orchestration (`apps/api/src/smplat_api/api/v1/endpoints/checkout.py`), and auth lockout tracking (`apps/api/src/smplat_api/api/v1/endpoints/auth.py:52`).
- The web app (`apps/web`) previously mirrored large portions of the domain model via Prisma. With NextAuth + notification/access-event flows now calling the FastAPI service, Prisma has been fully removed from the web package.
- The duplicated data access layer creates divergent sources of truth and schema drift (e.g., uppercase Prisma enums vs lowercase API enums in `apps/api/src/smplat_api/models/user.py:10`), making coordinated feature work brittle.
- Goal: retire the Prisma-backed API usage, rely on the FastAPI service for data access, and leave Prisma only where strictly necessary (e.g., if we retain NextAuth) or eliminate it entirely.

## Current `/api` Surface Summary

| Domain | Representative Endpoints | Notes |
| --- | --- | --- |
| Auth Hardening | `POST /api/v1/auth/attempts`, `GET /api/v1/auth/lockout` (`apps/api/src/smplat_api/api/v1/endpoints/auth.py:52`) | Lockout telemetry & lookup; expects hashed identifiers. |
| Orders | `GET /api/v1/orders`, `GET /api/v1/orders/{orderId}`, `PATCH /api/v1/orders/{orderId}/status` (`apps/api/src/smplat_api/api/v1/endpoints/orders.py:217`) | Full CRUD plus user-scoped listings and progress/onboarding subresources. |
| Checkout & Payments | `GET /api/v1/checkout/orchestrations/{orderId}` (`apps/api/src/smplat_api/api/v1/endpoints/checkout.py`), `POST /api/v1/payments/checkout` (`apps/api/src/smplat_api/api/v1/endpoints/payments.py`) | Stripe orchestration, processor observability, webhook ingestion. |
| Billing Ops | Invoices, hosted sessions, reconciliation, replay (`apps/api/src/smplat_api/api/v1/endpoints/billing.py`, `billing_sessions.py`, `billing_reconciliation.py`, `billing_replay.py`) | Supports finance tooling and Stripe lifecycle automations. |
| Catalog | Bundles, recommendations, experiments (`apps/api/src/smplat_api/api/v1/endpoints/catalog_merchandising.py`, `catalog_recommendations.py`, `catalog_experiments.py`) | CRUD + experimentation toggles and scheduler hooks. |
| Loyalty | Tiers, member snapshots, ledger, redemptions, guardrails, nudges (`apps/api/src/smplat_api/api/v1/endpoints/loyalty.py:409`) | Extensive customer loyalty tooling with pagination and next actions. |
| Observability | Catalog search insights, Prometheus expose (`apps/api/src/smplat_api/api/v1/endpoints/observability.py`) | Used for admin dashboards in web app. |
| Onboarding & Operators | Order onboarding and operator nudges (`apps/api/src/smplat_api/api/v1/endpoints/onboarding.py`, `operator_onboarding.py:11`) | Supports concierge workflows triggered from admin surfaces. |
| Instagram & Trust | Social analytics and trust content feeds (`apps/api/src/smplat_api/api/v1/endpoints/instagram.py`, `trust.py`) | Consumed by storefront and dashboard. |

The FastAPI service already encapsulates most domains that the frontend consumes; prior gaps tied to Prisma-centric tooling have been closed by migrating those flows to FastAPI.

## Prisma-Backed Functionality in `apps/web`

| Feature | Description | Touchpoints |
| --- | --- | --- |
| NextAuth identity store | ✅ Now backed by the REST adapter hitting FastAPI auth endpoints (`apps/web/src/server/auth/config.ts`, `apps/web/src/server/auth/rest-adapter.ts`); Prisma client removed from auth stack. |
| Notification preferences | ✅ Dashboard reads/writes preferences via FastAPI notifications endpoints (`apps/web/src/server/notifications/preferences.ts`). |
| Access event telemetry | ✅ Access decisions proxy to FastAPI security endpoints; Prisma access tables retired (`apps/web/src/server/security/access-events.ts`). |
| Checkout offer analytics | ✅ Route proxies to FastAPI analytics (`/api/v1/analytics/offer-events`); Prisma client retired. | `apps/web/src/app/api/analytics/offer-events/route.ts`, `apps/api/src/smplat_api/api/v1/endpoints/analytics.py` |
| Dev data seeding | ✅ Local bootstrap handled via FastAPI seeding utilities (`apps/api/tooling/seed_dev_users.py`); Node Prisma seeder removed. |

Operational traffic now runs through FastAPI; Prisma is no longer present in the web workspace.

## Discrepancy Analysis

| Area | Backend `/api` Status | Prisma Status | Impact | Recommended Backend Action |
| --- | --- | --- | --- | --- |
| Identity & sessions | FastAPI exposes `/api/v1/auth/*` CRUD for users/accounts/sessions/verification tokens | Web app consumes endpoints via REST adapter; Prisma auth tables retired (`apps/web/src/server/auth/config.ts`) | Unified source of truth; adapter/endpoint parity established | Keep enum/role casing translation in helpers and monitor FastAPI contract changes. |
| Notification preferences | `notifications` endpoints now cover get/update flows (`apps/api/src/smplat_api/api/v1/endpoints/notifications.py`) | Web app previously upserted directly via Prisma (`apps/web/src/server/notifications/preferences.ts:24`) | Dual writes retired; preferences now sourced from API | Frontend migrated to REST client; defaults maintained in backend service. |
| Access event logging | `/api/v1/security/access-events` records telemetry + metrics (`apps/api/src/smplat_api/api/v1/endpoints/security.py`) | Legacy Prisma access events module replaced (`apps/web/src/server/security/access-events.ts`) | Shared API ensures observability data lives with FastAPI | Frontend fetches/records via REST, keeping admin dashboards in sync. |
| Offer/upsell analytics | `/api/v1/analytics/offer-events` persists storefront interactions via FastAPI (`apps/api/src/smplat_api/api/v1/endpoints/analytics.py`) | Web route now proxies to the analytics endpoint; Prisma client retired (`apps/web/src/app/api/analytics/offer-events/route.ts`) | Unified analytics in FastAPI schema; Alembic owns migrations | Backfill reporting jobs against the new table and decommission any warehouse mirrors pointed at Prisma tables. |
| Enum & schema alignment | FastAPI uses lowercase enums (e.g., `user_role_enum`) | Prisma enums uppercase, additional tables defined but unused | Hard to swap sources without migration mapping | Consolidate enum helpers around FastAPI responses and remove lingering Prisma enum assumptions. |
| Dev tooling | API has Alembic + seed scripts | Prisma tooling retired | Single-stack dev workflows | Document FastAPI-based bootstrap flows and remove obsolete instructions. |

## Frontend Refactor Touchpoints

1. **Authentication stack** (✅ complete)
   - REST adapter in place; NextAuth now calls the FastAPI auth endpoints and Prisma client usage has been removed. Follow-up work: clean up residual Prisma schema files and ensure helper mappings stay in sync with backend enums.

2. **Notification preferences**
   - Replace Prisma calls in `apps/web/src/server/notifications/preferences.ts` with API fetch helpers once endpoints ship; update dashboard loader/actions (`apps/web/src/app/(admin)/admin/dashboard/page.tsx:58`, `apps/web/src/app/(admin)/admin/dashboard/actions.ts:31`).
   - Remove Prisma model usage after migration.

3. **Access event telemetry**
   - Swap `recordAccessEvent` implementation to POST to backend security endpoint, and fetch metrics via API (`apps/web/src/server/security/access-events.ts`, `apps/web/src/server/auth/policies.ts:24`, `apps/web/src/app/(admin)/admin/security/page.tsx:142`).
   - Coordinate schema for decisions/tier naming to match backend.

4. **Checkout offer analytics** (✅ complete)
   - Next.js route proxies to the FastAPI analytics endpoint, eliminating direct Prisma writes.
   - Alembic migration `20251203_34_checkout_offer_events.py` provisions the durable table and indexes.

5. **Prisma schema and tooling cleanup** (✅ complete)
   - Prisma schema, migrations, and seeders have been removed from the web workspace.

## Suggested Next Steps

1. **Enum/schema audit**: Validate FastAPI enum responses against frontend helpers; add regression tests for role/decision mappings.
2. **Dev tooling & CI**: Update onboarding docs to reference FastAPI seeding scripts and ensure CI pipelines no longer install Prisma.
3. **Analytics reporting** (✅ complete): `tooling/scripts/export_offer_events.py` exports `checkout_offer_events` for BI pipelines; legacy Prisma mirrors are retired.
4. **Regression coverage**: Continue regression checks (NextAuth login, notification toggles, security dashboard) against the new REST surfaces and expand automated coverage for the adapter + endpoints.

## Identity Adapter Migration Task (Completed)

- REST adapter now proxies all NextAuth adapter calls through FastAPI (`apps/web/src/server/auth/rest-adapter.ts`).
- FastAPI exposes the supporting CRUD endpoints for users, accounts, sessions, and verification tokens.
- Prisma auth client usage has been removed from the web app; local seed tooling (`apps/api/tooling/seed_dev_users.py`) drives shortcut provisioning.
- Follow-up: remove the obsolete Prisma auth schema/migrations and keep role/status mapping helpers aligned with backend enums.

Document retained for follow-up implementation sessions.
