# Backend Runtime & Database

## Local Postgres
- Provided via `docker-compose.yml` (`postgres` service, user/password `smplat`).
- Start locally:
  ```bash
  docker compose up postgres -d
  ```
- Stop & remove:
  ```bash
  docker compose down
  ```

## FastAPI Environment
- Ensure `.env` in `apps/api` points to the Postgres DSN (`postgresql+asyncpg://smplat:smplat@localhost:5432/smplat`).
- Run migrations (once migrations are defined):
  ```bash
  source .venv/bin/activate
  poetry run alembic upgrade head
  ```
- Start API:
  ```bash
  source .venv/bin/activate
  poetry run uvicorn smplat_api.app:create_app --factory --reload
  ```

## Background Processing
- Fulfillment worker is toggled via environment:
  ```bash
  FULFILLMENT_WORKER_ENABLED=true
  FULFILLMENT_POLL_INTERVAL_SECONDS=30
  FULFILLMENT_BATCH_SIZE=25
  ```
- When enabled, the FastAPI lifespan task spins up `TaskProcessor` and exposes two operational endpoints:
  - `/api/v1/fulfillment/health` &rarr; overall worker state, poll interval, batch size, and the latest run/error metadata.
  - `/api/v1/fulfillment/metrics` &rarr; counters and timestamps suitable for scraping by Prometheus/Grafana or posting to your APM.
- Recommended staging rollout:
  1. Set the `FULFILLMENT_*` variables in the deployment environment.
  2. Deploy the API and verify the health endpoint reports `running: true`.
  3. Add alerting on `loop_errors`, rising `tasks_failed`, or stale `last_run_finished_at`.
- The worker executes inside FastAPI’s lifespan task; for dedicated workers, reuse `TaskProcessor` with a standalone session factory.
- Smoke test the deployment with:
  ```bash
  python tooling/scripts/smoke_fulfillment.py --base-url https://<your-api-domain>
  ```
  ```bash
  python tooling/scripts/smoke_checkout.py --base-url https://<your-api-domain> --api-key $CHECKOUT_API_KEY
  ```
  > For local validation without binding ports, append `--in-process` (and pass a throwaway `--api-key` for the checkout script); the smoke runners will spin up the ASGI app and seed a demo product automatically.

## Admin Product Workflow
- Next.js admin portal (`/admin/products`) proxies to FastAPI using `API_BASE_URL`.
- Ensure `API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` are set (defaults to `http://localhost:8000`).
- The portal now supports create/update/delete with server actions; changes revalidate the admin view.

## Product Configuration API
- `GET /api/v1/products/{slug}` now returns configurable data (`optionGroups`, `addOns`, `customFields`, `subscriptionPlans`) sourced from Postgres.
- Use Alembic migration `20251015_05_product_configuration` to create the required tables/enums.
- Admin tooling to manage these entities is pending; seed data can be added via SQL or temporary scripts until the CMS/Admin UI is ready.
- Frontend configurator expects:
  - Option groups flagged as single/multiple with ordered options and price deltas.
  - Add-ons for optional upsells.
  - Custom fields capturing fulfillment inputs (text/url/number).
  - Subscription plans describing billing cadence adjustments (price multipliers or deltas).
- Seed the reference Instagram product configuration locally with:
  ```bash
  DATABASE_URL=postgresql+asyncpg://smplat:smplat@localhost:5432/smplat \
  python tooling/scripts/seed_product_configuration.py --slug instagram-growth
  ```

## API Security
- Order creation (`POST /api/v1/orders`) and checkout session initiation (`POST /api/v1/payments/checkout`) now require an internal `X-API-Key`. Configure `CHECKOUT_API_KEY` in both the FastAPI and Next.js `.env` files.
- The Next.js proxy route (`/api/checkout`) attaches the key automatically so browsers never expose the credential.
