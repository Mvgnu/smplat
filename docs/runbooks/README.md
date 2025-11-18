# Runbooks

This directory collects operational runbooks for the smplat platform.

Each document provides repeatable, end-to-end procedures for responding to events or validating capabilities in specific environments.

## Analytics Event Logging

- Checkout offer acceptance and onboarding journey events are captured via typed API layers:
  - `POST /api/v1/analytics/offer-events` persists impressions/CTA clicks via the FastAPI analytics service (backed by Alembic migration `20251203_34_checkout_offer_events`).
  - `POST /api/analytics/onboarding-events` now proxies to the FastAPI onboarding service which validates requests, toggles durable task state, and emits deltas into `onboarding_journey_events`.
- Operator dashboards or ad-hoc analysts can query `checkout_offer_events` and `onboarding_journey_events` directly from the FastAPI-managed Postgres schema (Alembic creates both tables and supporting indexes).
- Use `python tooling/scripts/export_offer_events.py --lookback-days 14 --format csv` to export storefront offer interactions for BI jobs or incident reviews.
- To view real-time client checklists, call `GET /api/onboarding/journeys/:orderId` from the Next.js app or query the FastAPI endpoint `/api/v1/orders/{orderId}/onboarding` directly with the checkout API key.

## Checkout Recovery Orchestration

- The full lifecycle for storefront checkouts is detailed in [`checkout-recovery.md`](./checkout-recovery.md).
- Includes API usage, scheduler expectations, notification hooks, and QA scenarios for stalled orders and recovery prompts.

## Merchandising Console

- The admin merchandising workflow is documented in [`merchandising-console.md`](./merchandising-console.md).
- Covers product channel gating, asset uploads, bundle CRUD, staging promotion, and QA expectations.

## Admin Console Handbook

- Operators can orient themselves using [`admin-console.md`](./admin-console.md).
- Details navigation patterns, module responsibilities, access controls, and support handoffs.

## Guardrail / Automation Exports

- [`guardrail-followups-export.md`](./guardrail-followups-export.md) explains how to schedule `tooling/scripts/export_guardrail_followups.py`, configure the GitHub Actions workflow, and land Snowflake COPY jobs so provider follow-up timelines stay in sync across Slack, analytics, and dashboards.

## Catalog QA Escalations

- [`catalog-qa-escalations.md`](./catalog-qa-escalations.md) provides Slack-ready macros for merchandising incidents. Every snippet now mandates the conversion deeplink (live vs. historical cursor) plus provider follow-up references, ensuring escalations outside guardrail runbooks still cite the correct slice.

## Incident Response

- Use [`incident-response.md`](./incident-response.md) to coordinate detection, mitigation, and
  postmortem steps across API workers and web surfaces.
