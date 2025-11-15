# Operator onboarding command center route

This directory hosts the `/admin/onboarding` route that powers the operator-facing onboarding command center. The page authenticates operators via the internal dashboard surface, fetches journey summaries and detail slices from the FastAPI operator endpoints, and exposes manual concierge controls.

Exports:

- `page.tsx` – server component that renders the overview panels, tables, and detail inspector.
- `actions.ts` – Next.js server actions that proxy manual nudge triggers and refresh the route.
- `manual-nudge-form.tsx` – client component providing the in-console manual nudge composer.

> meta: docs: admin-onboarding-console
