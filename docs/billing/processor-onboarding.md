# Processor Onboarding & Credential Rotation

This guide documents how to connect a production-grade payment processor to SMPLAT's billing stack.

## Prerequisites
- A Stripe account with access to the Dashboard and the ability to create restricted API keys.
- Operator access to the SMPLAT secrets manager or deployment environment variables.
- Workspaces promoted into the billing rollout allowlist (`BILLING_ROLLOUT_WORKSPACES`).

## Credential Provisioning
1. Generate a **restricted secret key** in Stripe limited to PaymentIntents, Refunds, and Checkout Sessions.
2. Store the key in the platform's secret manager under `STRIPE_SECRET_KEY`; never commit it to Git. The FastAPI service loads it via `settings.stripe_secret_key`.
3. Create a Webhook Signing Secret scoped to the `payment_intent.*` and `charge.*` events and set it as `STRIPE_WEBHOOK_SECRET`.
4. Provide a publishable key for the web client using `STRIPE_PUBLIC_KEY` if hosted checkout telemetry is required.

## Environment Configuration
Update the API deployment with the following variables:

```env
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLIC_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
BILLING_ROLLOUT_STAGE=ga
BILLING_ROLLOUT_WORKSPACES=<comma-separated workspace UUIDs>
```

Restart the API service after updating credentials. The `StripeBillingProvider` lazily loads keys from configuration on instantiation.

## Webhook Endpoint Registration
- Configure Stripe to target `POST {API_BASE_URL}/api/v1/billing/webhooks/stripe`.
- Use JSON delivery with the events:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
- Stripe will sign each payload; the API validates signatures with the stored webhook secret.

## Credential Rotation Procedure
1. Provision a replacement secret in Stripe.
2. Add the new secret to the secret manager under a temporary key (e.g., `STRIPE_SECRET_KEY_NEXT`).
3. Deploy the API with both secrets and set the feature flag `BILLING_ROLLOUT_STAGE=pilot` while validating.
4. Update the active `STRIPE_SECRET_KEY` to the new value and redeploy.
5. Remove the temporary key after verification and document the rotation in the operations log.

## Testing & Verification
- Run `pytest apps/api/tests/test_billing_gateway.py` to verify gateway logic and webhook ingestion locally.
- Trigger a test webhook from Stripe Dashboard and confirm invoices advance to the `paid` state.
- Check the `webhook_replay_token` column to confirm duplicate events are skipped.

## Incident Response
- If a webhook signature fails, Stripe retries with exponential backoff. Monitor logs for repeated failures and regenerate the signing secret if compromised.
- Disputed charges should surface as `charge.refunded` events; finance operators can review discrepancies inside the reconciliation tooling.

