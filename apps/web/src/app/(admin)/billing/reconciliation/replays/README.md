# Billing Replay Console

This directory contains the operator-facing replay console for processor ledger events. The `page.tsx`
server component fetches replay metadata from the billing API and renders the interactive client view in
`replay-dashboard.tsx`.

Capabilities include:

- Filtering by provider, replay status, and correlation identifier fragments.
- Inspecting replay attempts, request metadata, and last error context.
- Triggering replays (including force replays) through the proxied Next.js API route with optimistic UI
  feedback.

Update this document when expanding replay insights, modifying filter behavior, or adding new operator
controls.
