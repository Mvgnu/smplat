# SMPLAT Monorepo

Full-stack platform for social media service storefronts.

## Apps
- `apps/web` – Next.js storefront, client and admin portals.
- `apps/api` – FastAPI backend, integrations, and automation.
- `apps-cms-payload` – Next.js + Payload admin (default CMS provider).
- `apps/cms` – Legacy Sanity Studio retained for fallback while Payload parity is finalised.

## Getting Started
1. Install pnpm and Poetry.
2. Copy environment templates:
   ```bash
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   ```
3. Install dependencies:
   ```bash
   pnpm install
   (cd apps/api && poetry install)
   ```
4. Start backing services:
   ```bash
   docker compose up postgres -d
   pnpm payload:seed:dev   # seeds Payload collections for local development
   ```

5. Run apps:
   ```bash
   pnpm --filter @smplat/cms-payload dev   # Payload admin + APIs (http://localhost:3050)
   pnpm dev           # Next.js + other JS workspaces
   poetry run uvicorn smplat_api.app:create_app --factory --reload  # API
   ```

6. (Optional) Seed configurable product data for local demos:
   ```bash
   DATABASE_URL=postgresql+asyncpg://smplat:smplat@localhost:5432/smplat \\
   python tooling/scripts/seed_product_configuration.py --slug instagram-growth
   ```

### Fulfillment Worker
- Controlled via `FULFILLMENT_WORKER_ENABLED`, `FULFILLMENT_POLL_INTERVAL_SECONDS`, and `FULFILLMENT_BATCH_SIZE` in `apps/api/.env`.
- When enabled, the worker runs inside the FastAPI process and exposes metrics at `/api/v1/fulfillment/metrics` plus aggregated stats at `/api/v1/fulfillment/observability`.
- For staging/production, set the env vars, deploy, and monitor the observability endpoint (or export to your telemetry stack) to ensure tasks are processed.
- Run the worker smoke test after deploy:
  ```bash
  python tooling/scripts/smoke_fulfillment.py --base-url https://staging.smplat.example
  ```
  The script verifies `/healthz`, `/api/v1/fulfillment/metrics`, and `/api/v1/fulfillment/observability`.

### Observability Scripts
- `tooling/scripts/smoke_checkout.py` — exercises the checkout flow, payment observability (`/api/v1/payments/observability`), and internal order creation.
- `tooling/scripts/check_observability.py` — consolidated validation for fulfillment, payments, and catalog search telemetry (including a zero-result rate SLO). Fails with non-zero exit status when thresholds are exceeded, making it ideal for CI/CD gates.
- `tooling/scripts/export_catalog_insights.py` — exports top catalog queries and zero-result searches (JSON/Markdown) to feed merchandising experiments.
- `tooling/scripts/validate-payload-preview.mjs` — automates Payload preview and webhook validation; run via `pnpm payload:validate` once environment secrets point at a live Payload + marketing deployment pair.
- `.github/workflows/observability-checks.yml` — GitHub Actions job that runs the consolidated checker with the staging API base URL and checkout API key stored as repository configuration.
  - Runs the catalog observability pytest suite via Poetry before executing runtime checks.
  - Uploads Markdown/JSON catalog insights artifacts for merchandising after each run.
- `docs/18-fulfillment-observability.md` and `docs/19-ci-observability.md` describe staging rollout and CI integration patterns.
- Prometheus scrape endpoint: `/api/v1/observability/prometheus` (requires `X-API-Key` with the checkout key) aggregates fulfillment, payments, and catalog counters for exporters.
- Grafana dashboard (`docs/20-grafana-dashboard.json`) and runbook (`docs/20-observability-dashboards.md`) provide ready-to-import visualizations and alert rule suggestions.

### Storefront buyer flow
- Product catalog: `/products`
- Configurable service detail page with cart entry: `/products/[slug]`
- Cart review: `/cart`
- Checkout form & Stripe handoff: `/checkout`
- Post-payment success page clears cart: `/checkout/success`
- Set `CHECKOUT_API_KEY` in both `apps/api/.env` and `apps/web/.env`; the frontend proxies checkout requests through `/api/checkout` and attaches the key via `X-API-Key`.
- Payload seeds include product landing pages so storefront detail routes render CMS-driven hero, metrics, testimonials, and FAQs. Set `CMS_PROVIDER=sanity` in `apps/web/.env` if you need to temporarily fall back to Sanity and ensure the matching Sanity datasets are seeded.

Refer to `/docs` for architecture, roadmap, and implementation details.
