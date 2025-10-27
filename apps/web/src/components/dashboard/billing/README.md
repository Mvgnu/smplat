# Billing dashboard components

These components power the client billing center experience rendered on `/dashboard`. They are
used by the server component in `apps/web/src/app/(client)/dashboard/page.tsx` and expect data from
`@/server/billing/invoices`.

## Components

- `BillingCenter` – renders the workspace billing summary, invoice table, and aging breakdown.
- `CampaignIntelligenceGrid` – displays spend-to-performance cards correlating invoices with
  fulfillment and Instagram analytics insights.

Each component includes structured metadata comments (`// meta: key: value`) so automation can
track features and ownership. Keep this README in sync when adding new billing UI elements.
