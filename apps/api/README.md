# SMPLAT FastAPI Service

## Local Development
```bash
poetry install
poetry run uvicorn smplat_api.app:create_app --factory --reload
```

## Testing
```bash
poetry install  # ensures pytest-asyncio and other plugins are present
poetry run pytest
```

See `/docs` for full architecture decisions.

## Billing Gateway Integration
- Hosted Stripe Checkout session endpoint: `POST /api/v1/billing/invoices/{invoiceId}/checkout` (requires `X-API-Key`).
- Webhook receiver: `POST /api/v1/billing/webhooks/stripe` validates Stripe signatures, persists the raw payload, and applies payment lifecycle updates.
- Processor event ledger: `/api/v1/billing/webhooks/stripe` writes to `processor_events` before mutating invoices. Replay
  operations live under `/api/v1/billing/replays` for deterministic reprocessing.
- Reconciliation endpoints under `/api/v1/billing/reconciliation` expose runs, discrepancies, and resolution actions for finance teams.
- Durable ingestion cursors are persisted in the `billing_sync_cursors` table. Each reconciliation run logs per-workspace cursor checkpoints so operators can monitor ingestion progress (see `docs/billing/reconciliation.md`).
- Run `poetry run pytest apps/api/tests/test_billing_gateway.py` before deployments touching billing flows.
