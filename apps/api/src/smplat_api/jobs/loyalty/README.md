# Loyalty Job Suite

This module coordinates scheduled tasks for the loyalty domain:

- `aggregate_loyalty_nudges` refreshes persisted nudge records from upstream signals so follow-up runs can safely dispatch reminders without duplicating work.
- `dispatch_loyalty_nudges` delivers nudges using multi-channel fallback (email → SMS → push) and records dispatch events for cooldown + observability tracking.
- `capture_loyalty_analytics_snapshot` persists predictive segmentation snapshots.
- `run_loyalty_progression` grants streak bonuses, expires points, and handles other cadence-driven updates.

Jobs are configured via `apps/api/config/schedules.toml`; see `docs/runbooks/loyalty-referrals.md` for operational procedures and alerting expectations.
