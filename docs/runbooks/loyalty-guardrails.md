# Loyalty Guardrail Console

The loyalty guardrail console gives operators live visibility into referral invite
quotas, cooldown timers, and throttle posture while providing a guarded path for
temporarily relaxing limits.

## API Surface

- `GET /api/v1/loyalty/guardrails` returns aggregate metrics including active
  invites, members at quota, cooldown status, and currently active overrides.
- `POST /api/v1/loyalty/guardrails/overrides` creates a scoped override. Each
  override records justification, optional member targeting, expiry, and audit
  events. Creating a new override automatically supersedes prior active entries
  for the same scope.

## Operator Workflow

1. Navigate to `/admin/loyalty` (RBAC enforced via `requireRole("operator")`).
2. Review KPIs for invite pressure, cooldown health, and override count.
3. Inspect the guardrail table and override timeline to confirm existing manual
   adjustments.
4. Submit the override form with scope, justification, optional member ID, and
   expiry window. CSRF tokens are required; server actions call FastAPI via the
   `@/server/loyalty/guardrails` bridge.
5. Overrides revalidate the page after completion so KPIs and tables reflect the
   new posture.

## Testing & Bypass

- Playwright tests set `NEXT_PUBLIC_E2E_AUTH_BYPASS=true`, activating the
  in-memory snapshot in `guardrails.ts`. This enables UI verification without a
  running API.
- API coverage lives in `apps/api/tests/test_loyalty_guardrails.py` and asserts
  override creation plus aggregate calculations.

## Operational Notes

- Guardrail overrides expire automatically via the stored `expires_at` value; a
  follow-up worker should prune stale rows if expiration volume grows.
- Audit events capture both creation and automatic revocation when a new
  override supersedes another.
- Extend the console with additional guardrails by expanding
  `LoyaltyGuardrailOverrideScope` and the matching dataclass serialization.
