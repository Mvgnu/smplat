# Billing Replay Console

This directory contains the operator-facing replay console for processor ledger events. The `page.tsx`
server component fetches replay metadata from the billing API and renders the interactive client view in
`replay-dashboard.tsx`.

Capabilities include:

- Workspace, provider, status, and correlation filtering with live polling updates powered by the
  billing replay API cursor.
- Detailed replay timelines with attempt metadata, error context, and invoice snapshots surfaced in the
  investigative drawer.
- Triggering replays (including force replays) through the proxied Next.js API route with optimistic UI
  feedback.

Update this document when expanding replay insights, modifying filter behavior, or adding new operator
controls.
