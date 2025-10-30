# Incident Response Guide

The SMPLAT platform now emits structured traces and logs from both FastAPI and Next.js
surfaces. Use this guide to triage production incidents quickly and document the
recovery.

## Detection
- **Automated alerts**
  - **Fulfillment/notification jobs**: Alert when `/api/v1/health/readyz` returns
    `status=degraded` or `status=error`, or when any component shows
    `status=error`. Poll this endpoint at least every 60 seconds.
  - **Scheduler failures**: Monitor `smplat_catalog_scheduler_*` metrics in the
    Prometheus feed and alert on non-zero `consecutive_failures` for more than
    5 minutes.
  - **Notification backlog**: Alert when the weekly digest scheduler logs
    `server_action_failed` events or when the loyalty nudge dispatch job emits
    spans with `otel.status_code=ERROR`.
  - **Auth anomalies**: Track spikes in `/api/v1/auth/attempts` vs.
    `/api/v1/auth/lockout` responses and alert when lockout counts exceed 3 per
    minute.
- **Manual checks**
  - Review the structured log stream (search for `service=smplat-api` or
    `namespace=app`) for `server_action_failed` events.
  - Inspect Grafana dashboard sections “Loyalty Pipeline Health” (nudges,
    guardrails, referrals) and “Scheduler Readiness” to confirm ongoing delivery.

## Mitigation
1. **Stabilise the surface**
   - Flip feature flags or temporarily disable workers via settings to stop
     cascading failures (e.g., set `hosted_recovery_worker_enabled=false`).
   - Use `/api/v1/health/readyz` component details to restart only the affected
     worker (fulfillment processor, bundle guardrail worker, catalog scheduler,
     weekly digest scheduler, or hosted recovery worker).
2. **Reduce user impact**
   - For storefront issues, suspend promotional banners or loyalty redemptions
     by adjusting CMS flags; server actions will log spans when they fail so
     you can confirm suppression.
   - Notify operators via the admin console banner; reference the span IDs from
     the structured logs so they can correlate to backend traces.
3. **Implement tactical fixes**
   - Re-run failed jobs (`tooling/scripts/run_weekly_digest.py`,
     `tooling/scripts/onboarding_nudges.py`) once readiness reports `ready`.
   - Reprocess failed hosted checkout recoveries with
     `HostedSessionRecoveryWorker.run_once(triggered_by="manual")` from a
     Python shell after verifying `smplat_hosted_session_recovery` tables.

## Postmortem
- **Capture context**
  - Export relevant spans from your OTLP collector (filter on
    `service.name IN ["smplat-api", "smplat-web"]` and the incident timestamp).
  - Save `/api/v1/health/readyz` payloads captured during the incident and any
    `server_action_failed` log entries.
- **Document**
  - File a retrospective in `docs/reflections/` summarising root cause, blast
    radius, and remediation steps. Include trace IDs for future correlation.
  - Update applicable runbooks (security, loyalty guardrails, merchandising) if
    process changes were required.
- **Prevent recurrence**
  - Create follow-up tasks for missing alerts, insufficient telemetry, or code
    gaps identified during the response.
  - Re-run Playwright regression suites covering protected routes to ensure no
    RBAC regressions slipped in during emergency fixes.

## Contacts & Escalation
- Primary on-call: `ops@smplat.test`
- Secondary: `engineering-lead@smplat.test`
- Escalate to leadership via `#incident-room` Slack channel when incidents last
  longer than 30 minutes or impact active checkout sessions.
