# Loyalty & Referral Platform Runbook

This runbook captures operational guidance for the loyalty tier system and referral credits.

## API & Storefront Overview
- **Storefront hub**: `/account/loyalty` renders tier progress, balances, expiring points, and the reward catalog using server-side hydration of the loyalty APIs. The hub invokes secure server actions that forward redemptions to the upstream API with the checkout key to preserve abuse protections.
- **List tiers**: `GET /api/v1/loyalty/tiers` returns active tiers ordered by threshold.
- **Membership lookup**: `GET /api/v1/loyalty/members/{user_id}` lazily provisions loyalty members and now surfaces tier progress, point holds, upcoming benefits, and expiring balances.
- **List rewards**: `GET /api/v1/loyalty/rewards` exposes active reward catalog definitions for storefront and admin surfaces.
- **Member referral list**: `GET /api/v1/loyalty/referrals` returns the authenticated member's invites (requires session headers).
- **Member referral create**: `POST /api/v1/loyalty/referrals` issues a new invite using session-aware quotas and cooldowns.
- **Member referral cancel**: `POST /api/v1/loyalty/referrals/{referral_id}/cancel` voids an invite while preserving conversion telemetry.
- **Issue referral invite**: `POST /api/v1/loyalty/members/{user_id}/referrals` (admin only) mints a referral code and persists metadata for downstream messaging.
- **Complete referral**: `POST /api/v1/loyalty/referrals/complete` (admin only) associates the invite with a newly onboarded user, credits the referrer, and emits a tier upgrade notification if thresholds are met.
- **Create redemption**: `POST /api/v1/loyalty/members/{user_id}/redemptions` (admin only) reserves points for a reward slug or custom amount.
- **Fulfill redemption**: `POST /api/v1/loyalty/redemptions/{redemption_id}/fulfill` finalizes the hold, deducts points, and emits ledger metadata.
- **Fail/Cancel redemption**: `POST /api/v1/loyalty/redemptions/{redemption_id}/fail|cancel` releases the hold and records the operational reason.

## Database Objects
- `loyalty_tiers`: Configurable tiers with thresholds and benefit payloads.
- `loyalty_members`: Per-user membership row tracking balances, holds, and active tier.
- `loyalty_ledger_entries`: Immutable ledger of point changes and metadata including streak bonuses and expirations.
- `loyalty_referral_invites`: Lifecycle of referral codes and conversion state.
- `loyalty_rewards`: Catalog of redeemable perks with cost metadata.
- `loyalty_redemptions`: Tracks redemption reservations, fulfillment state, and ledger linkage.
- `loyalty_point_expirations`: Schedules and audits outstanding balance expirations.

## Scheduler & Jobs
- `run_loyalty_progression` (APScheduler) grants weekly streak bonuses, processes expirations via `LoyaltyService.expire_scheduled_points`, and emits job telemetry. Configure via `CatalogJobScheduler` when enabling loyalty cadence.
- Health snapshots surface through scheduler telemetry endpoints—verify `loyalty` sweep metrics are present before campaign launches.

## Notifications
Tier upgrades trigger the `NotificationService.send_loyalty_tier_upgrade` helper which honors marketing preferences and renders the `render_loyalty_tier_upgrade` template. Templates live alongside other notification assets to keep formatting consistent.

## QA Checklist
1. Apply migrations via `poetry run alembic upgrade head` from `apps/api`.
2. Seed baseline tiers and reward catalog entries ensuring thresholds ascend and slugs are unique.
3. Call `/loyalty/members/{user_id}` to provision a member and confirm progress/expiring payloads populate.
4. Run `poetry run pytest tests/test_loyalty_service.py tests/test_loyalty_endpoints.py` to validate redemption flows and API responses.
5. Exercise redemption creation → fulfillment → cancellation via API to verify holds, ledger entries, and scheduler expirations.
6. Run `NEXT_PUBLIC_E2E_AUTH_BYPASS=true pnpm --filter web test:e2e -- --grep "Loyalty hub"` to execute the storefront redemption happy-path Playwright suite. The spec covers optimistic balance updates, success messaging, and error fallback.
7. Run `NEXT_PUBLIC_E2E_AUTH_BYPASS=true pnpm --filter web test:e2e -- --grep "Referrals"` to cover invite creation, share links, cancellation, and throttle messaging.
8. Issue a referral and manually mark it converted to validate ledger updates and notifications.
9. Confirm TypeScript contracts in `packages/types` and storefront consumers are refreshed.

## Troubleshooting
- **Missing notification**: Verify `notification_preferences.marketing_messages` is enabled for the user before expecting tier announcements.
- **Duplicate referral code**: Codes are regenerated on collision; if issues persist inspect `loyalty_members.referral_code` uniqueness and confirm migrations ran.
- **Tier not upgrading**: Ensure tier thresholds use numeric values and benefits payload remains JSON serializable.
- **Insufficient balance during redemption**: Confirm available balance exceeds hold request and release stale holds via `/redemptions/{id}/cancel` when necessary.
- **Expiration mismatch**: Inspect `loyalty_point_expirations` rows for remaining balance vs. ledger adjustments and rerun `run_loyalty_progression` for catch-up.
- **Member invite throttled**: Verify `referral_member_max_active_invites` and `referral_member_invite_cooldown_seconds` in API settings. Inspect `loyalty_referral_invites` for lingering `sent`/`draft` rows and cancel to clear quota if needed.
