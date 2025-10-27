# Client dashboard overview

The dashboard now layers billing history and campaign intelligence alongside order progress and
notification preferences.

## Sections

- **Fulfillment progress** – unchanged; still renders order selection and task metrics.
- **Billing center** – consumes `fetchBillingCenterPayload` and renders the `BillingCenter`
  component.
- **Notification preferences** – includes a new `billingAlerts` toggle that is persisted via
  `updateNotificationPreferencesAction`.

Data sources:

- `@/server/billing/invoices` proxies the FastAPI billing endpoints (secured with
  `CHECKOUT_API_KEY`).
- Billing exports and reminders are proxied through `/api/billing/[invoiceId]/*` routes so Next.js
  can attach auth headers and download responses.
- Campaign intelligence cards blend invoice totals, fulfillment status, and Instagram analytics to
  highlight performance deltas.

Update this document when new dashboard surface areas are introduced.
