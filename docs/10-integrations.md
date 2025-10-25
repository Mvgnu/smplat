# External Integrations Plan

## Overview
- Primary integrations: Stripe (payments/billing), Instagram Graph API (analytics/fulfillment), Lexoffice (bookkeeping).
- Secondary providers: Email (Postmark), Auth (OAuth providers), Notification channels.
- All integrations wrapped in dedicated service modules with retry, observability, and contract tests.

## Stripe
- **Scope**: Checkout sessions, payment intents, subscriptions, invoices, customer portal.
- **Implementation Steps**:
  1. Configure Stripe products/prices matching catalog SKUs and subscription plans.
  2. Implement FastAPI webhook endpoint (`/webhooks/stripe`) with signature verification and idempotency keys.
  3. Map events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `payment_intent.payment_failed`.
  4. Integrate Stripe Billing Portal for client self-service (update payment method, cancel subscriptions).
  5. Handle tax via Stripe Tax (if adopted) or custom VAT calculation pipeline.
  6. Ensure PCI DSS compliance by tokenizing payments (no card data storage).
- **Testing**: Use Stripe CLI for webhook testing; create integration tests that replay sample events.

## Instagram Graph API
- **Scope**: Fetch profile insights, media metrics, audience demographics; optional content scheduling.
- **Prerequisites**: Business account, Facebook App review, appropriate permissions (`instagram_basic`, `instagram_manage_insights`, `pages_show_list`).
- **Implementation Steps**:
  1. Implement OAuth flow for clients to connect Instagram accounts (through Facebook login).
  2. Store long-lived access tokens in `integration_credentials` with refresh schedule (60-day tokens).
  3. Create background sync jobs pulling metrics daily/hourly (depending on tier) with caching.
  4. Normalize insights into `instagram_account_snapshots`; provide aggregated API endpoints for dashboards.
  5. Handle rate limits and errors; implement exponential backoff and fallbacks.
- **Testing**: Use mock services or sandbox data for development; integration tests with recorded fixtures.

## Lexoffice
- **Scope**: Customer records, invoices, payments.
- **Implementation Steps**:
  1. Complete OAuth2 client credentials setup; securely store tokens.
  2. Build API client with typed requests/responses; align with GoBD requirements.
  3. Implement push workflow upon invoice creation; include attachments (PDF).
  4. Poll or webhook (if available) for payment status updates; update local ledger.
  5. Log and alert on failures; provide admin UI for manual retry.
- **Testing**: Use Lexoffice sandbox where available; maintain contract tests validated against API schema.

## Sequencing & Milestones
1. **Foundation (Phase 0-1)**
- Stripe: initial checkout integration to unlock sales.
- Stripe: ensure webhook idempotency logging (`webhook_events` table) and internal API key protection for order/checkout proxies.
- Email provider: transactional emails for auth and receipts.
2. **Client Portal (Phase 2)**
   - Instagram OAuth + data sync for dashboard metrics.
   - Stripe Billing Portal integration.
3. **Operations (Phase 3-4)**
   - Lexoffice integration for invoices/payments.
   - Automation workers for recurring sync jobs.
4. **Hardening (Phase 4-5)**
   - Monitoring dashboards, alerting, contract tests for all integrations.
   - Failover strategies (e.g., queue retries, circuit breakers).

## Observability & Reliability
- Unified integration logger with correlation IDs per external call.
- Metrics: request count, latency, error rate, retry count per provider.
- Circuit breaker patterns to protect core services during outages.
- Document runbooks for incident response per integration.

## Security
- Store credentials encrypted, rotate regularly.
- Limit OAuth scopes to minimum required.
- Validate payloads and signatures; use allowlist of webhook source IPs when possible.
- Regularly review provider status pages, configure uptime alerts.
