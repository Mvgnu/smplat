# Fulfillment Provider Catalog

## Overview

The fulfillment provider catalog replaces the in-memory registry with persisted models, API endpoints, and an admin UI. Providers and their services are now stored in the database, enabling operators to manage credentials, rate limits, health metadata, and region availability without code changes.

Key goals:

- Centralise provider + service metadata in SQL tables (`fulfillment_providers`, `fulfillment_services`).
- Expose FastAPI CRUD endpoints for programmatic management.
- Provide an admin dashboard (`/admin/fulfillment/providers`) to register, update, and audit catalog entries.
- Keep pricing validation (`service_exists`) in sync via the cached registry backed by the new tables.

## Data Model

### `fulfillment_providers`
- `id` (`text`, PK) — stable identifier used by overrides and services.
- `name` (`text`, required) — operator-friendly label.
- `description` (`text`, optional) — freeform notes.
- `base_url` (`text`, optional) — upstream API endpoint root.
- `allowed_regions` (`jsonb`, optional) — array of ISO region codes the provider supports.
- `credentials` (`jsonb`, optional) — encrypted/placeholder credential payloads.
- `metadata_json` (`jsonb`, optional) — arbitrary metadata (docs, contacts, SLA info).
- `metadata_json.automation.endpoints` (JSON, optional) — structured endpoint definitions used by automation. Each provider can define `order`, `balance`, and `refill` endpoints with `{ "method": "POST", "url": "https://...", "headers": { ... }, "payload": { ... } }`. The admin UI exposes these fields so operators can configure how we call upstream APIs, map response fields, and reference values (e.g., `{{providerOrderId}}`) when sending refills.
- `rate_limit_per_minute` (`integer`, optional) — provider-level throttling guidance.
- `status` (`enum: active|inactive`) — operational status.
- `health_status` (`enum: unknown|healthy|degraded|offline`) — current health snapshot.
- `last_health_check_at` (`timestamptz`, optional) — timestamp of most recent manual/automated health check.
- `health_payload` (`jsonb`, optional) — structured health telemetry (latencies, errors, custom data).
- `created_at`, `updated_at` — managed timestamps.

### `fulfillment_services`
- `id` (`text`, PK) — service/action identifier referenced by add-on overrides.
- `provider_id` (`text`, FK → fulfillment_providers.id`) — owning provider.
- `name` (`text`, required) — human-readable name.
- `action` (`text`, required) — action token consumed by fulfillment workers.
- `category` (`text`, optional) — classification (followers, engagement, etc.).
- `default_currency` (`text`, optional, length 3) — billing currency reference.
- `allowed_regions`, `credentials`, `metadata_json`, `rate_limit_per_minute`, `status`, `health_status`, `last_health_check_at`, `health_payload`, `created_at`, `updated_at` — mirror provider semantics at action granularity.

An initial dataset for the legacy `xyz` provider and follower service is seeded by Alembic migration `20251210_39_fulfillment_provider_catalog.py`. The legacy alias `svc_followers_eu` remains available.

## FastAPI Endpoints

All endpoints live under `/api/v1/fulfillment/providers` and require the usual admin authentication.

- `GET /` → list providers with nested services.
- `GET /{providerId}` → provider detail.
- `POST /` → create provider; accepts payload matching `FulfillmentProviderCreate`. Optional fields default to empty arrays/maps.
- `PATCH /{providerId}` → update provider; send partial payload (snake_case) for targeted changes.
- `DELETE /{providerId}` → cascade delete provider and services.
- `POST /{providerId}/services` → create service for provider.
- `GET /{providerId}/services/{serviceId}` → service detail.
- `PATCH /{providerId}/services/{serviceId}` → partial update for service.
- `DELETE /{providerId}/services/{serviceId}` → remove service.

Pydantic response payloads use camelCase aliases for UI friendliness (`baseUrl`, `healthStatus`, `allowedRegions`, etc.). The backend cache (`smplat_api.domain.fulfillment.provider_registry`) is refreshed on every create/update/delete and on app startup.

## Admin UI (`/admin/fulfillment/providers`)

- **Register new provider** — top-of-page form capturing ID, name, base URL, regions, rate limit, status, health metadata, credentials, and arbitrary JSON payloads. Empty JSON fields can be left blank; they default to `{}`/`null`.
- **Provider endpoints & automation** — The admin form includes JSON editors for order/balance/refill endpoints. Each accepts an object with `method`, `url`, optional `headers`, and `payload` templates. These definitions drive automated balance checks, provider fund tracking, and future refill actions. Templates may reference handlebars-style placeholders (`{{amount}}`, `{{providerOrderId}}`) that the fulfillment workers resolve at runtime.
- **Provider settings** — each provider card exposes editable fields mirroring the API schema. Health status changes accept optional `lastHealthCheckAt` (via datetime-local input) and structured payloads for telemetry.
- **Service management** — beneath each provider, operators can add new services or update existing ones. Inputs include action keys, categories, currencies, per-service rate limits, and health payloads.
- **Deletion** — provider and service removal buttons run through CSRF-protected server actions. Deleting a provider cascades to its services.
- **Validation** — JSON fields are parsed server-side; malformed input returns inline errors without committing changes.
- **Balance visibility** — each provider card surfaces the latest balance snapshot (amount/currency + timestamp). The scheduled `fulfillment-provider-balance` job reads the configured `balance` endpoint and stores the raw payload so ops can see wallet health without leaving the UI.

The UI relies on server actions with CSRF + `requireRole("operator")` checks and revalidates the route on every mutation.

## Registry + Validation Notes

- The provider registry cache refreshes automatically on API mutations and every 15 minutes while the app is running.
- A scheduled job (`fulfillment-provider-health`, runs every 15 minutes) now pings each provider's `baseUrl` + `/health` (or the `metadata.health.endpoint` override) and records latency/status in `fulfillment_providers` and `fulfillment_services`. Service entries inherit the provider snapshot unless they declare their own health endpoint. Results populate the admin UI instantly because the registry refreshes after every snapshot.
- `ProductAddOnPricing` validation (`service_exists`) now reflects persisted services; ensure services are created before wiring overrides in admin merchandising flows.
- The balance + health schedulers share the automation endpoint metadata; keep these endpoints current so downstream jobs and fulfillment hooks stay accurate.
- Fulfillment workers call `provider_registry.refresh_catalog` before recording overrides, ensuring real-time metadata for audit rows.

## Migration Checklist

1. Apply migrations in order: `20251210_38_fulfillment_provider_orders` (existing) then `20251210_39_fulfillment_provider_catalog`.
2. Backfill existing service overrides to map to new service IDs if necessary.
3. Update environment variables or secrets stores with provider credentials; the catalog persists JSON but does not handle encryption yet.
4. Verify admin UI access and run `pnpm --filter @smplat/web test:unit -- product-configurator.test.tsx` to confirm no pricing regressions.
