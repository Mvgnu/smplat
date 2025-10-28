# Hosted Session Recovery Playbook

_Last updated: 2025-10-18_

This playbook documents how the automated hosted session recovery workflow operates and the
operator touchpoints available through the dashboard and API.

## Automation Overview
- Scheduler (`schedule_hosted_session_recovery`) selects stalled hosted checkout sessions based on
  `next_retry_at`, `retry_count`, and status. Optimistic locks ensure concurrent workers cannot
  mutate the same record.
- Each attempt records structured metadata (`recovery_attempts`, `automation.last_attempt`,
  `last_notified_at`) so the dashboard timeline can replay the decision trail.
- Communications are dispatched through `HostedSessionRecoveryCommunicator`, emitting email/SMS
  stubs and logging channel/template usage in `communication_log`.

## Operator Visibility
- The dashboard renders the **Recovery Timeline** component, highlighting attempts, next retry
  windows, and notification cadences per session.
- Regeneration API responses now include an annotated `recoveryState` payload so UI consumers can
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
   if entries do not materialize within five minutes.

For escalations (e.g., processor outage), disable automation by pausing the scheduler worker and
log the incident in the Problem Tracker before issuing manual outreach.
