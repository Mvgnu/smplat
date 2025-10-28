# Billing operations and replay procedures

The billing processor ledger captures every webhook event before any business logic executes. This
section documents the core operating procedures for finance and platform operators.

## Processor event ledger

- **Table**: `processor_events` records each webhook with provider, payload hash, correlation IDs,
  workspace hints, and replay metadata.
- **Idempotency**: Webhooks first call `record_processor_event`. Duplicate events short-circuit using
  provider + external ID and provider + payload hash uniqueness.
- **Replay orchestration**: When a new event is recorded the API marks it as replay-requested, then
  `register_replay_attempt` clears the flag upon a successful mutation. Events that fail invoice
  lookups remain queued for operator review.

## Replay APIs

- `GET /api/v1/billing/replays` lists ledger entries. Use `requestedOnly=false` to include processed
  events or `provider` filters when triaging specific gateways. The `workspaceId` query parameter
  scopes results to a tenant, while the optional `since` cursor returns only events received after the
  provided timestamp (ISO-8601).
- `GET /api/v1/billing/replays/{eventId}` returns a single event with replay attempt history and a
  lightweight invoice snapshot. Supplying `workspaceId` enforces tenant isolation for the lookup.
- `POST /api/v1/billing/replays/{eventId}/trigger` flags an event for replay. Passing
  `{ "force": true }` executes an immediate replay. Without `force` the request schedules background
  processing and returns accepted.
- Replay attempts are capped at five by default. Exceeding the threshold returns HTTP 409 to prevent
  uncontrolled loops.

## Worker responsibilities

- `ProcessorEventReplayWorker` reads the ledger, validates payloads, and replays supported providers.
- Stripe payloads reuse the same invoice mutation logic as live webhooks, guaranteeing deterministic
  outcomes between live ingestion and replays.
- Missing invoices, malformed payloads, or unsupported providers keep events queued (`replay_requested`
  remains true) and log a descriptive `last_replay_error`.

## Operational workflow

1. **Monitor queue** – Use the replay list endpoint or admin UI to monitor queued events
   (`replayRequested=true`). Investigate repeated `lastReplayError` values.
2. **Investigate root cause** – Resolve underlying data issues (e.g., create the missing invoice) before
   triggering a replay.
3. **Trigger replay** – Issue a replay request. Use `force=true` for emergency scenarios after verifying
   the payload.
4. **Verify results** – Confirm the linked invoice reflects the expected payment timeline updates. Check
   that the event now shows `replayRequested=false` and `replayAttempts` incremented.
5. **Escalate** – If retries continue to fail, capture context in the billing problem tracker and escalate
   to the payments engineering rotation.

## Admin replay console walkthrough

The `/admin/billing/reconciliation/replays` surface exposes replay orchestration controls without requiring
API tooling. Operators should:

1. **Filter context** – Select the workspace, processor provider, and replay status from the filter
   controls. Use the correlation search box for invoice IDs or partial correlation IDs. Setting the
   workspace selector updates the API queries to respect tenant isolation.
2. **Live monitoring** – The console polls the replay API every few seconds using the `since` cursor to
   surface new events and status transitions without requiring manual refreshes. Connection failures are
   surfaced inline so operators can retry or fall back to manual fetches.
3. **Inspect history** – Choose **Inspect event** to open the investigative drawer. The drawer shows the
   full replay timeline, attempt metadata, error payloads, and invoice snapshot so operators can confirm
   downstream impact before triggering another replay.
4. **Trigger replay** – Use **Trigger replay** to queue another attempt. The UI optimistically updates
   status badges and shows confirmation. Operators can still issue a **Force replay** when a 409
   (`Replay limit reached`) response is returned and the payload has been vetted.
5. **Verify** – Confirm the drawer timeline reflects new attempts or eventual success. The live polling
   loop will merge newly completed events, but the **Refresh** control remains available via the browser
   for manual reconciliation.

Screenshots and walkthroughs are maintained in the admin README to align with evolving UI patterns.

## Documentation hygiene

- Update this runbook whenever new processors, replay guardrails, or operator tools ship.
- Reflect replay learnings and mitigations in `docs/reflections/` after major incidents to maintain a
  living knowledge base.
