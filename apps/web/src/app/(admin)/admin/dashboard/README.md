# Client dashboard overview

The dashboard now layers billing history and campaign intelligence alongside order progress and
notification preferences.

## Sections

- **Fulfillment progress** – unchanged; still renders order selection and task metrics.
- **Billing center** – consumes `fetchBillingCenterPayload` and renders the `BillingCenter`
  component. Capture and refund actions call into the API proxies so the UI can display ledger
  timelines, processor references, and adjustment history for each invoice.
- **Notification preferences** – includes a new `billingAlerts` toggle that is persisted via
  `updateNotificationPreferencesAction`.

Data sources:

- `@/server/billing/invoices` proxies the FastAPI billing endpoints (secured with
  `CHECKOUT_API_KEY`).
- Billing exports and reminders are proxied through `/api/billing/[invoiceId]/*` routes so Next.js
  can attach auth headers and download responses.
- Campaign intelligence cards blend invoice totals, fulfillment status, and Instagram analytics to
  highlight performance deltas.
- Payment metadata (timeline pills, settlement markers, adjustments) is sourced from the invoice
  ledger columns introduced in Alembic revision `20251018_09`.

Update this document when new dashboard surface areas or ledger visualizations are introduced.
