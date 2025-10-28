# Hosted Session Recovery Playbook

_Last updated: 2025-10-29_

This playbook documents how the automated hosted session recovery workflow operates and the
operator touchpoints available through the dashboard and API.

## Automation Overview
- Scheduler (`schedule_hosted_session_recovery`) selects stalled hosted checkout sessions based on
  `next_retry_at`, `retry_count`, and status. Optimistic locks ensure concurrent workers cannot
  mutate the same record.
- A dedicated worker (`HostedSessionRecoveryWorker`) executes the scheduler on an interval defined
  by environment configuration. Each execution persists a `hosted_session_recovery_runs` entry so
  operators can audit cadence, outcome counts, and notification providers.
- Each attempt records structured metadata (`recovery_attempts`, `automation.last_attempt`,
  `last_notified_at`) so the dashboard timeline can replay the decision trail.
- Communications are dispatched through `HostedSessionRecoveryCommunicator`, delivering SendGrid
  email or Slack webhook alerts when feature flags and credentials are present. When integrations
  are disabled or misconfigured, structured stub logs continue to populate `communication_log`.

## Deployment & Scheduling
- Enable automation by setting `HOSTED_RECOVERY_WORKER_ENABLED=true` and configuring cadence knobs:
  `HOSTED_RECOVERY_INTERVAL_SECONDS`, `HOSTED_RECOVERY_LIMIT`, and
  `HOSTED_RECOVERY_MAX_ATTEMPTS`.
- The FastAPI service starts the worker during application lifespan management; alternatively run
  one-off executions via `python tooling/scripts/run_hosted_session_recovery.py` for cron or ad-hoc
  recovery sweeps.
- Inspect `hosted_session_recovery_runs` for recent iterations. Each row surfaces the trigger label,
  schedule limits, and notification providers used during the sweep.

## Notification Channels
- Email dispatches use SendGrid when `HOSTED_RECOVERY_EMAIL_ENABLED` is `true` and the following
  environment variables are configured: `SENDGRID_API_KEY`, `SENDGRID_SENDER_EMAIL`, and
  `HOSTED_RECOVERY_EMAIL_RECIPIENTS` (comma-delimited list).
- Slack escalations require `HOSTED_RECOVERY_SLACK_ENABLED=true` and
  `HOSTED_RECOVERY_SLACK_WEBHOOK_URL`; optionally set `HOSTED_RECOVERY_SLACK_CHANNEL` to target a
  specific destination.
- When integrations are unavailable, the communicator falls back to metadata logging while still
  updating the timeline for operator visibility.

## Operator Visibility
- The dashboard renders the **Recovery Timeline** component, highlighting attempts, next retry
  windows, and notification cadences per session.
- Regeneration API responses include an annotated `recoveryState` payload so UI consumers can
  hydrate automation state without re-querying metadata.
- Session metadata exposes overrides (`automation.override_next_retry_at`) and trigger audit fields
  (`triggered_by`, `triggered_at`, `trigger_notified`).

## Manual Overrides
- Regeneration endpoint accepts optional `overrideNextRetryAt` and `automated` flags for scripted
  workflows. When supplied, the scheduler respects the new retry window and appends audit metadata.
- Operators can manually trigger notifications by invoking the communicator through internal tools;
  all stubs record into `communication_log` for accountability.

## Runbook Steps
1. Review dashboard Recovery Timeline for stalled sessions (>3 attempts without notification).
2. If cadence adjustments are needed, call `/api/v1/billing/sessions/{id}/regenerate` with an
   `overrideNextRetryAt` window and `automated=true` to document the change.
3. Confirm new attempts and communication events appear in the timeline; investigate scheduler logs
   (including `hosted_session_recovery_runs`) if entries do not materialize within five minutes.

For escalations (e.g., processor outage), disable automation by pausing the scheduler worker and
log the incident in the Problem Tracker before issuing manual outreach.
