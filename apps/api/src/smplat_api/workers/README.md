# Workers

This package hosts long-running async workers that orchestrate background automation.

- `BillingLedgerReconciliationWorker` aligns invoice state with gateway statements.
- `HostedSessionRecoveryWorker` schedules stalled hosted checkout sessions for recovery, records durable run metadata, and coordinates notifications.
- `BundleExperimentGuardrailWorker` evaluates running experiments, pauses breached variants, and dispatches guardrail alerts.
- `ProviderOrderReplayWorker` scans fulfillment provider orders for due scheduled replays, invokes the automation service, and records success/failure trails for operators.

> meta: docs: workers-overview
