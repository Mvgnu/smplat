# Security posture updates

## RBAC enforcement
- Middleware (`apps/web/middleware.ts`) now evaluates sessions for `/admin`, `/dashboard`, `/account`, and select API
  routes. Requests without an authenticated session are redirected to `/login` with the original path captured via `next`.
- `requireRole` (`apps/web/src/server/auth/policies.ts`) exposes `member`, `operator`, and `admin` tiers mapped to
  FastAPI `UserRole` values. Layouts and server actions call this helper to assert privileges before hydrating the
  `SessionProviderBoundary`.

## CSRF protections
- `getOrCreateCsrfToken` stores a double-submit token in the `smplat.csrf` cookie and surfaces the same value for form inputs
  rendered by server components.
- Server actions invoke `ensureCsrfToken` to compare the posted token against the signed cookie (and optional `x-smplat-csrf`
  header). Non-production and test bypasses log warnings instead of throwing.

## Session persistence
- NextAuth callbacks persist `roleSnapshot` and `permissions` via the FastAPI identity endpoints so server-rendered components can
  enforce role-aware features without recomputing permissions.
- Local environments rely on Alembic-managed schemas; run `poetry run alembic upgrade head` inside `apps/api` after pulling new migrations.

## Operator onboarding
- Promote operators by calling the FastAPI admin endpoints or issuing direct SQL updates against the API schema: set `role`
  to `FINANCE` for operator access or `ADMIN` for full control. New sessions capture permission snapshots automatically.
- For local bootstrap, execute `poetry run python apps/api/tooling/seed_dev_users.py` to provision super-operators with the
  expected role assignments.

## HTTP security headers
- `apps/web/next.config.mjs` appends a platform-wide CSP, HSTS, Permissions-Policy, and X-Frame-Options header set. Adjust
  allowed domains by editing the `selfCsp` array. Changes require a rebuild to take effect in production.
- Ops should verify CDN/CDN-less deployments preserve these headers—use `curl -I https://app.smplat.test/login` after each
  release.

## Session cookie posture
- NextAuth now issues `__Host-` prefixed cookies in production with `SameSite=Lax` and `Secure` enforced.
- Ensure environment variables set `NODE_ENV=production` in hosted environments; otherwise cookies default to non-Host names
  for local testing.

## API rate limiting and lockouts
- Middleware enforces edge rate limiting for `/api/auth`, `/api/checkout`, `/api/loyalty`, and `/api/onboarding`. Defaults allow
  10 auth attempts/min and 20–30 calls/min for other sensitive routes. Adjust counts in `apps/web/middleware.ts` when onboarding
  new surfaces.
- Redis-backed lockout counters live in `apps/api/src/smplat_api/services/auth/lockout_service.py` with tunables in
  `smplat_api/core/settings.py`. Defaults: 5 attempts within 5 minutes triggers a 15-minute lock.
- Client login preflights call `GET /api/v1/auth/lockout` before requesting a magic link and reports failed attempts via
  `POST /api/v1/auth/attempts`. Successful session creation notifies the API through NextAuth events to reset counters.
- Incident checklist: flush Redis keys matching `auth:*` after validating the event window, rotate API tokens if suspicious
  traffic replays originate off-network, and coordinate with ops before widening thresholds.

## Operational telemetry
- Poll `/api/v1/health/readyz` alongside `/healthz` to confirm fulfillment, recovery, scheduler, and digest workers are ready.
- Structured JSON logs now include `service`, `trace_id`, and `span_id`. Search for `server_action_failed` to correlate web
  server action failures with FastAPI traces captured via OTLP exporters.
