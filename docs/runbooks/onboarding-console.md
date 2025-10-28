# Onboarding command center runbook

## Purpose
The `/admin/onboarding` console gives operators a single command center for reviewing every onboarding journey, triaging blockers, and orchestrating concierge nudges. It consumes the FastAPI operator endpoints shipped in this change set and complements the existing order and fulfillment consoles.

## Access & Authentication
- Surface lives at `https://app.smplat.local/admin/onboarding` (adjust per environment).
- Requires the same operator authentication stack as other admin routes; ensure Auth.js session includes the `operator` role.

## Key Panels
1. **Journey inventory** – Summaries with risk bands, stalled filters, referral toggles, and quick progress snapshots.
2. **Journey inspector** – Details for the selected journey including tasks, artifact receipts, interaction history, and live nudge opportunities.
3. **Concierge composer** – Manual nudge form that lets operators dispatch email or Slack reminders while logging outcomes.

## Operator Workflow
1. Load the command center and scan the high-level stats for spikes in stalled or referral journeys.
2. Filter to stalled or referral-only modes when specific playbooks are required.
3. Select a journey to review task status, outstanding artifacts, and the automated nudge queue.
4. If automation already queued a nudge, confirm the SLA window and escalate manually only when context requires personalization.
5. Use the manual nudge composer to send tailored reminders. Operators must include their initials/name for auditing.
6. After dispatch, verify a new interaction entry appears in the “Recent interactions” list.

## Automated Nudges
- Script location: `tooling/scripts/onboarding_nudges.py`.
- Recommended schedule: every 2 hours via cron or a workflow runner.
- Default idle threshold: 24 hours (configurable via `--idle-hours`).
- Dry-run mode (`--dry-run`) swaps the notification backend to in-memory delivery for testing.
- Each run writes structured interaction metadata (`nudge.key`, `nudge.triggered_by`, SLA idle hours) for audit trails.

## Escalation & Failure Modes
- **No journeys visible** – Confirm checkout API key is configured in the environment; operator endpoints require it.
- **Manual nudge errors** – Check NotificationService SMTP credentials and user notification preferences; opt-outs will log the nudge but skip delivery.
- **Automation drift** – If the cron job fails, review CI/CD logs, run the script manually with `--dry-run`, and verify interactions insert properly. Update this runbook after the incident with remediation notes.

> meta: docs: onboarding-command-center-runbook
