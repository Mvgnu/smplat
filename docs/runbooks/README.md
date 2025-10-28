# Runbooks

This directory collects operational runbooks for the smplat platform.

Each document provides repeatable, end-to-end procedures for responding to events or validating capabilities in specific environments.

## Analytics Event Logging

- Checkout offer acceptance and onboarding journey events are captured via Next.js API routes:
  - `POST /api/analytics/offer-events` persists impressions/CTA clicks to the `checkout_offer_events` table.
  - `POST /api/analytics/onboarding-events` records progress and referral signals to `onboarding_journey_events`.
- Tables are created automatically on first write; operators can query them with `psql` or Prisma for bundle uptake and onboarding completion reporting.
