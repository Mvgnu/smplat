# Runbooks

This directory collects operational runbooks for the smplat platform.

Each document provides repeatable, end-to-end procedures for responding to events or validating capabilities in specific environments.

## Analytics Event Logging

- Checkout offer acceptance and onboarding journey events are captured via typed API layers:
  - `POST /api/analytics/offer-events` persists impressions/CTA clicks to the `checkout_offer_events` table managed by Prisma migrations (`apps/web/prisma/migrations/202510300001_add_offer_and_onboarding_events`).
  - `POST /api/analytics/onboarding-events` now proxies to the FastAPI onboarding service which validates requests, toggles durable task state, and emits deltas into `onboarding_journey_events`.
- Operator dashboards or ad-hoc analysts can query `checkout_offer_events` and `onboarding_journey_events` via Prisma or the warehouse mirror; both tables and their indexes are provisioned via migrations (no more lazy CREATE TABLE statements).
- To view real-time client checklists, call `GET /api/onboarding/journeys/:orderId` from the Next.js app or query the FastAPI endpoint `/api/v1/orders/{orderId}/onboarding` directly with the checkout API key.

## Checkout Recovery Orchestration

- The full lifecycle for storefront checkouts is detailed in [`checkout-recovery.md`](./checkout-recovery.md).
- Includes API usage, scheduler expectations, notification hooks, and QA scenarios for stalled orders and recovery prompts.

## Merchandising Console

- The admin merchandising workflow is documented in [`merchandising-console.md`](./merchandising-console.md).
- Covers product channel gating, asset uploads, bundle CRUD, staging promotion, and QA expectations.
