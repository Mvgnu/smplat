# Catalog Server Utilities

Fetches deterministic bundle recommendations and experimentation telemetry from the
FastAPI layer and normalizes responses for storefront consumers and operator tools.

- `recommendations.ts` – wraps `/api/v1/catalog/recommendations`.
- `experiments.ts` – wraps `/api/v1/catalog/experiments` for CRUD + guardrail evaluation.
