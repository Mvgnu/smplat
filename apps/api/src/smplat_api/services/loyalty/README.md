# Loyalty Service

Provides orchestration helpers around loyalty tier progression, ledger entries, redemption fulfillment, and referral issuance.
The service is intentionally thin and reuses shared notification infrastructure for tier upgrade alerts.

## Capabilities

- Tier progression orchestration with streak bonus emission and upgrade notifications.
- Ledger management for earning, redemption, referral, and adjustment events with optional point expirations.
- Redemption flow helpers for reserving balances, fulfilling rewards, and reversing on failure.
- Point expiration scheduling utilities consumed by the loyalty progression job.
- Proactive nudge aggregation that merges expiring points, stalled redemptions, and checkout reminders into persisted cards and notification-ready payloads.
