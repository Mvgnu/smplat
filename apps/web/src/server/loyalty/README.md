# Loyalty server bridge

Utilities in this folder call the FastAPI loyalty endpoints on behalf of the
Next.js application. Keep functions focused on data transport and reuse them
from API routes or server components instead of fetching from the client.

- `timeline.ts` stitches ledger, redemption, and referral conversion windows into a
  server-driven activity timeline, normalizing cursors so client surfaces can
  paginate without reimplementing merge logic. The module also exposes
  `configureLoyaltyTimelineFetchers`/`resetLoyaltyTimelineFetchers` helpers so
  tests can replace the default transport layer with deterministic mocks.
- `guardrails.ts` wraps the guardrail console endpoints, providing bypass
  scaffolding for e2e tests and helpers to create overrides from server actions.
