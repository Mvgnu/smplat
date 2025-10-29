# Loyalty & Referral Platform Runbook

This runbook captures operational guidance for the loyalty tier system and referral credits.

## API Overview
- **List tiers**: `GET /api/v1/loyalty/tiers` returns active tiers ordered by threshold.
- **Membership lookup**: `GET /api/v1/loyalty/members/{user_id}` lazily provisions loyalty members and surfaces the latest point balances.
- **Issue referral invite**: `POST /api/v1/loyalty/members/{user_id}/referrals` (admin only) mints a referral code and persists metadata for downstream messaging.
- **Complete referral**: `POST /api/v1/loyalty/referrals/complete` (admin only) associates the invite with a newly onboarded user, credits the referrer, and emits a tier upgrade notification if thresholds are met.

## Database Objects
- `loyalty_tiers`: Configurable tiers with thresholds and benefit payloads.
- `loyalty_members`: Per-user membership row tracking balances and active tier.
- `loyalty_ledger_entries`: Immutable ledger of point changes and metadata.
- `loyalty_referral_invites`: Lifecycle of referral codes and conversion state.

## Notifications
Tier upgrades trigger the `NotificationService.send_loyalty_tier_upgrade` helper which honors marketing preferences and renders the `render_loyalty_tier_upgrade` template. Templates live alongside other notification assets to keep formatting consistent.

## QA Checklist
1. Apply migrations via `poetry run alembic upgrade head` from `apps/api`.
2. Seed baseline tiers (see fixtures or admin console) ensuring thresholds ascend.
3. Use the `/loyalty/members/{user_id}` endpoint to generate a member.
4. Issue a referral and manually mark it converted to validate ledger updates and notifications.
5. Confirm TypeScript contracts in `packages/types` are up to date for frontend consumers.

## Troubleshooting
- **Missing notification**: Verify `notification_preferences.marketing_messages` is enabled for the user before expecting tier announcements.
- **Duplicate referral code**: Codes are regenerated on collision; if issues persist inspect `loyalty_members.referral_code` uniqueness and confirm migrations ran.
- **Tier not upgrading**: Ensure tier thresholds use numeric values and benefits payload remains JSON serializable.
