# Onboarding journey client utilities

Server-only helpers for fetching and mutating onboarding journeys through the FastAPI service. These wrappers centralize API-base URL resolution, checkout API key handling, and typed responses for use in Next.js routes and server components.

Exports:

- `fetchOnboardingJourney(orderId)` – returns the durable journey snapshot for dashboards.
- `ensureOnboardingJourney(orderId, payload)` – idempotently hydrates journeys after checkout.
- `toggleOnboardingTask(orderId, taskId, completed)` – updates task completion via the typed API.
- `recordOnboardingReferral(orderId, referralCode)` – records referral copy events for analytics.

> meta: docs: onboarding-journey-client
