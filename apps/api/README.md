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
- Webhook receiver: `POST /api/v1/billing/webhooks/stripe` validates Stripe signatures and applies payment lifecycle updates.
- Run `poetry run pytest apps/api/tests/test_billing_gateway.py` before deployments touching billing flows.
