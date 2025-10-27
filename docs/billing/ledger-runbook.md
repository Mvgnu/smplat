# Billing ledger payment lifecycle runbook

The billing service now emits real-time metadata for invoice captures and refunds. This document
summarizes the operational flow and touch points for the payment ledger.

## Feature overview

- **Capture endpoint** – `POST /api/v1/billing/invoices/{invoiceId}/capture` triggers gateway capture
  through `BillingGatewayClient`. Partial captures are supported by providing an `amount` payload.
- **Refund endpoint** – `POST /api/v1/billing/invoices/{invoiceId}/refund` appends ledger adjustments
  and issues a synthetic refund record for analytics.
- **Gateway facade** – `BillingGatewayClient` populates `payment_intent_id`, `external_processor_id`,
  settlement timestamps, timeline events, and cumulative adjustments on the `Invoice` model.
- **Reconciliation worker** – `BillingLedgerReconciliationWorker` backfills missing timeline entries
  and settlement timestamps to keep historical data coherent.

## Operational guidelines

1. **Rollout toggles** – Gateway operations respect `settings.billing_rollout_stage`. Keep the stage in
   `pilot` until downstream teams finish QA on the dashboard updates.
2. **Invoice schema** – Alembic revision `20251018_09` introduces ledger columns. Run migrations before
   invoking capture/refund endpoints in any environment.
3. **Testing** – `apps/api/tests/test_billing_endpoint.py` now includes capture/refund coverage. Run
   `poetry run pytest apps/api/tests/test_billing_endpoint.py::test_capture_invoice_partial_updates_balance_and_timeline`
   prior to deployments touching the gateway.
4. **Dashboard UX** – The billing center now visualizes payment timelines, settlements, and adjustment
   history. Confirm the UI renders correctly after schema changes by loading the dashboard for a seeded
   workspace.
5. **Reconciliation cadence** – Schedule the reconciliation worker hourly. It is idempotent and safe to
   rerun; it only updates invoices missing settlement metadata.

## Alerting hooks

- Export notification logic is unchanged. When a capture succeeds, payments can trigger downstream
  notifications via the existing notification service.
- Add Grafana panels tracking capture volume and refund frequency using the structured metadata emitted
  by the gateway events (processor IDs, timestamps).

## Future enhancements

- Replace the synthetic gateway logic with a real provider client once credentials are available.
- Enrich the reconciliation worker with processor statement ingestion to validate captured totals.
- Persist granular adjustment reason codes to support finance audits.


## Processor event ledger integration

- Alembic revision `20251026_15` provisions the `processor_events` ledger capturing provider IDs, payload hashes, workspace hints, and replay metadata. Run migrations before enabling the new webhook flow.
- Stripe webhooks are now persisted before invoice mutations. The API enforces idempotency through ledger lookups and returns `{ "status": "duplicate" }` when the event already exists.
- Replay orchestration uses `ProcessorEventReplayWorker` and `/api/v1/billing/replays` endpoints. Operators can trigger reprocessing after resolving upstream issues without re-sending webhooks.
- Failed replays keep `replayRequested` flagged with descriptive `lastReplayError` values. Monitor these when triaging incidents.
