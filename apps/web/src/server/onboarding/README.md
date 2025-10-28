# Onboarding journey client utilities

Server-only helpers for fetching and mutating onboarding journeys through the FastAPI service. These wrappers centralize API-base URL resolution, checkout API key handling, and typed responses for use in Next.js routes and server components.

Exports:

- `fetchOnboardingJourney(orderId)` – returns the durable journey snapshot for dashboards.
- `ensureOnboardingJourney(orderId, payload)` – idempotently hydrates journeys after checkout.
- `toggleOnboardingTask(orderId, taskId, completed)` – updates task completion via the typed API.
- `recordOnboardingReferral(orderId, referralCode)` – records referral copy events for analytics.
- `fetchOperatorJourneys(params)` – loads operator-facing journey summaries with aggregates for the admin console.
- `fetchOperatorJourneyDetail(journeyId)` – retrieves journey detail including tasks, artifacts, interactions, and nudge opportunities.
- `dispatchOperatorManualNudge(journeyId, payload)` – dispatches a manual concierge nudge via the operator API surface.

> meta: docs: onboarding-journey-client
