# Billing Reconciliation Admin Surface

This directory contains the finance-facing reconciliation dashboard for operators. The `page.tsx` server
component assembles data from the billing API and renders the interactive client component in
`reconciliation-dashboard.tsx`.

Key capabilities:

- Summaries for staging backlog, open discrepancies, and failed runs.
- Run history table with failure metadata surfaced from API run notes.
- Staging triage workspace with inline note capture, triage, resolve, and requeue actions that forward
  to the FastAPI backend through Next.js API routes.
- Discrepancy log with status filtering for quick investigation.

Update this document when adding new reconciliation panels or altering the data flow between server
fetchers and the UI.
