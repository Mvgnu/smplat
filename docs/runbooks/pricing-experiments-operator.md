# Pricing experiment triage runbook

## Purpose
Equip concierge teams with a single reference for interpreting the new pricing experiment cards, KPI chips, and filters on `/admin/onboarding`. This runbook explains how the underlying `/api/v1/operators/onboarding/journeys` filters work, what each metric represents, and how to escalate anomalies back to merchandising.

## Surfaces & prerequisites
- **Admin UI**: `https://app.smplat.local/admin/onboarding` (replace host per environment). Requires operator access and a configured `CHECKOUT_API_KEY` so the server helper can call the FastAPI endpoints.
- **Automation reports**: `/admin/reports` guardrail + automation panels surface the same experiment KPIs, live guardrail alerts, and “Follow up” controls that open the provider automation view (`/admin/fulfillment/providers/[id]/automation`). Use this tab when you need to correlate experiment anomalies with automation backlogs or log quick remediation actions.
- **API**: `GET /api/v1/operators/onboarding/journeys?experimentSlug={slug}&experimentVariant={variant}` with the checkout API key header. Responses now embed `pricingExperiments` per journey plus aggregate counts for the dashboard chips.
- **Conversion snapshot API**: `GET /api/v1/reporting/onboarding/experiment-conversions?limit=25&cursor=` returns the same `{slug, orderTotal, orderCurrency, orderCount, journeyCount, loyaltyPoints, lastActivity}` payload that powers the Slack moneybag block and weekly digest emails. Next.js fetch helpers live in `apps/web/src/server/reporting/experiment-conversion-snapshot.ts` so `/admin/reports` can hydrate the KPIs on demand without duplicating formatting logic, and the reporting page now surfaces the `nextCursor` inline so ops know when to fetch the next slice via the API.
- **Telemetry feed**: PDP, checkout, success, and account flows record `journeyContext.pricingExperiments` and forward structured events to the analytics service and onboarding event stream (see `apps/web/src/lib/pricing-experiment-events.ts`). When `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is unset, events proxy through `/api/telemetry` which forwards to the server-only `TELEMETRY_ENDPOINT` so follow-up automation stays online even if browsers cannot reach the collector directly.

Weekly digests now depend on this conversion feed: `/api/v1/health/readyz` surfaces that dependency via the `weekly_digest` component, and if `WEEKLY_DIGEST_ENABLED` is `false` the scheduler will log (and the docs should mention) that conversion rows are suppressed in outbound emails/Slack digests until the flag is restored.

### Guardrail automation playbook

Use the `/admin/reports` guardrail badges to decide when to take action:

- **Critical alerts (`>2 guardrail fails` or `>4 replay failures`)** – Auto-pause the offending variant, log a follow-up with action `pause`, and drop a Slack notice in `#concierge-automation` using the template rendered on the reporting page:

```
:warning: Guardrail alert for *{providerName}* `{slug}`
• Failures: {guardrailFailures} · Replays: {replayFailures}/{replayTotal}
• Action: {actionTaken} (notes: {notes})
• {Live/Historical} conversion slice: <https://app.smplat.local/admin/reports{?conversionCursor=...}#experiment-analytics|Open conversions>
<https://app.smplat.local/admin/fulfillment/providers/{providerId}?tab=automation|Open dashboard>
```

- **Warnings** – Investigate and either resume automation (log a `resume` follow-up) or escalate with notes explaining the mitigation.
- Always include the dashboard deeplink so follow-up owners can jump straight into `/admin/fulfillment/providers/[id]?tab=automation`.
- The reporting UI now auto-sends this Slack payload when you click “Pause variant” or “Resume automation” and logs the persisted status via `POST /api/v1/reporting/guardrails/followups`, so ops rooms immediately see who took action plus the latest notes. The Slack block now includes a conversions deeplink labeled “Live conversion snapshot” or “Historical conversion slice” based on the current `?conversionCursor=` query param, so anyone following the alert knows whether they’re reviewing a stale slice. Manual copy/paste is only required if you are composing a bespoke escalation outside the dashboard—be sure to include the conversions link + cursor note when you do.
- Follow-up entries now capture the conversion cursor + link inline. The timeline drawers on `/admin/reports`, `/admin/onboarding`, and `/admin/fulfillment/providers` render a “Open conversions” helper that tells reviewers whether the action referenced a historical slice, so analytics exports and Snowflake sinks can attribute each pause/resume to the right conversion context.
- Follow-up status is stored per provider and mirrored in `/admin/reports` (“Paused” badge) plus automation Slack alerts, so you can refresh the page later and still see which variants remain paused even if the follow-up feed paginates older entries.
- The provider automation worker now auto-pauses critical breaches and records the playbook step (“Auto pause triggered by provider automation alerts worker”), then resumes the provider (and logs another follow-up) once the telemetry clears. Slack digests now append a `:robot_face:` block enumerating every provider that was automatically paused or resumed (with deeplinks to `/admin/fulfillment/providers/[id]?tab=automation`), so concierges can react even if nobody is in the UI or when the worker resumes variants overnight.
- The automation run history widget on `/admin/reports` mirrors those auto actions: alert rows now display guardrail chips per provider (pause/resume) and the summary text highlights which providers were auto-paused/resumed during that run. Operators should reference this panel when validating guardrail playbook outcomes before taking additional manual steps.
- The automation cadence card (top of `/admin/reports`) now lists the latest auto guardrail actions inline next to the alert digest so you don’t have to scroll down to the history table to see who was paused/resumed automatically.
- Hover or long-press any auto guardrail chip to reveal a tooltip that combines the worker’s pause/resume reason, notes, and the exact `ranAt` timestamp. This applies to the cadence card and the run history list so you can audit action timing without opening Slack or digging through logs.
- Auto guardrail chips now include an inline **Open follow-ups** link that lands directly on `/admin/fulfillment/providers/[id]?tab=automation`, making it trivial to read the persisted follow-up entry, add notes, or clear a pause without hunting for the provider elsewhere in the UI.
- `/admin/onboarding` now mirrors these auto guardrail chips inside the “Variant guardrails” panel so queue operators spot recent auto pauses/resumes without leaving the command center. Use those inline links when triaging journeys mid-scroll; they open the same follow-up timeline as `/admin/reports`.
- The journey detail drawer now shows the linked provider automation timeline (including pause/resume entries and current status) so you can audit follow-ups the moment you select a journey instead of bouncing back to `/admin/reports`.
- Weekly digest emails and provider automation Slack digests now append a conversion snapshot link and explicitly label when a `?conversionCursor=` is present (“Historical conversion slice”) so anyone opening the deep link knows they are looking at a historical snapshot instead of live telemetry.
- The journey detail drawer inherits the same chips so once you select a stalled order you can immediately jump into the provider’s follow-up tab (no need to scroll back to the analytics tiles first).

## Reading the dashboard
1. **Experiment KPI header** – The “Pricing experiments” card on the left shows:
   - `All experiments` chip resets the filters and shows total journeys with experiment metadata.
   - One block per slug with the number of journeys currently attributed to that slug.
   - Within each block, an `All` chip filters by slug only and child chips filter by `{slug, variantKey}`; counts represent journeys (not raw exposures) whose latest event recorded that variant.
2. **Journey cards** – Each summary row now displays badges for referred risk and progress plus a condensed list of the experiments tied to that order. Selecting a journey reveals the full experiment card (variant name, control tag, assignment strategy, recorded timestamp).
3. **Variant detail card** – Inside the inspector, experiment cards reiterate:
   - **Slug** and variant display name/key.
   - **Control vs. challenger** tag so ops can communicate positioning accurately.
   - **Assignment strategy** hint (sequential, random split, feature flag) to explain why a customer received a given price.
   - **Captured timestamp** sourced from `onboarding_journey_events`. If this looks stale, confirm the success page fired its analytics event for the order.
4. **Concierge insights** – The new “Pricing experiments” section summarizes journeys per slug and highlights the top variants with a “Focus” link that auto-filters the table. Use this to identify which cohorts need manual nudges or guardrail adjustments before drilling into individual journeys.
5. **Experiment analytics** – Right below the KPI row you will now find two new visualizations:
   - **Daily assignments** plots 10 days of experiment events pulled from `/api/v1/reporting/onboarding/experiment-events`. Each slug gets a sparkline plus the last three datapoints so you can see whether exposure volume is trending up/down before you export the CSV.
   - **Variant guardrails** lists the busiest variants with live counts of `active` vs. `stalled` journeys. Every row surfaces `Focus journeys` (filters the table) and `Export CSV` (jumps to the download controls with the slug pre-filled in the query string) shortcuts so concierge teams can drill deeper or pull analytics for coaching conversations.
   - **Conversion snapshots** now summarize per-slug orders, journeys, revenue impact, and loyalty projections (plus the last activity timestamp) so you can tell which experiments are actually booking dollars/points without leaving the dashboard. Use it to prioritize stalled journeys vs. slugs that are already converting and to quote the latest “$ impact” metric when updating merchandising or automation peers.
  - When you follow a deep-link with `?conversionCursor=...`, both `/admin/onboarding` and `/admin/reports` display a banner reminding you that you’re viewing historical slices and provide a “Clear conversions cursor” shortcut wired to a server action (no JS required) that strips the query param, reloads the dashboard, and jumps directly to the analytics panel reset button. Inside the conversions card you’ll also see an amber-tinted header + ⏱ badge whenever a historical cursor is active so the state stays obvious mid-scroll.

## Workflow for filtering journeys
1. Identify the slug that needs attention (e.g., weekly reviews of `spring-offer` conversions).
2. Click the slug’s `All` chip to scope the journey list. KPIs at the top update immediately to reflect the filtered set (stalled, referrals, progress).
3. Narrow to a specific variant if the slug-level counts show performance concerns. Variant chips match the query parameters (`experimentSlug`, `experimentVariant`) sent to the API route.
4. Open individual journeys to cross-check task completion, nudge opportunities, and experiment impact. Variant tags appear on the success summary and account receipts, so customer-facing messaging should match what you see here.
5. If telemetry appears off (e.g., customer mentions a discount but no variant recorded), capture the order number and escalate to the merchandising/pricing channel with the slug + environment; they will inspect the FastAPI analytics proxy.

## Guardrail & automation follow-ups in `/admin/reports`
1. Open `/admin/reports` and review the **Guardrail alerts** panel: each row now shows its suspected platform context (chips pulled from the latest orders) plus a “Review automation” action. Clicking it deep-links to `/admin/fulfillment/providers/[id]/automation` with the provider + channel context applied so you can inspect replays/refills without rebuilding filters.
2. Use the inline **Log follow-up** control (the GuardrailAlertActions component) whenever you take action—pause a variant, resume automation, escalate, etc. Notes persist via `POST /api/v1/reporting/guardrails/followups` and every entry emits telemetry via `trackGuardrailAutomation`, so ops + analytics can audit remediation volume and SLAs per platform/channel.
3. When an alert references a specific experiment variant, jump between `/admin/reports` and `/admin/onboarding` using the shared chips to validate whether stalled journeys align with the guardrail event. The platform chips on success/account tables now match the alert payload, making it easy to confirm you are triaging the correct handle/channel.
4. Update this runbook if you discover a new guardrail action path (e.g., Slack automation, webhook toggles). Document the alert code, expected follow-up, and telemetry emitted so future operators can replay the same workflow quickly.
5. Expand the **Follow-up history** accordion on each alert to audit the last few actions (powered by `GET /api/v1/reporting/guardrails/followups?providerId=...&limit=5`). Click **Load more** to pull older notes via `nextCursor`. The feed mirrors the guardrail notes panel embedded in `/admin/fulfillment/providers`, so any log you capture from the alert view automatically rolls up to the provider detail page.
6. Slack digests triggered by provider automation now include a `:moneybag:` block summarizing the top conversion slugs (revenue, orders/journeys, loyalty points, and recency). Reference that snippet when posting follow-ups in ops channels so everyone sees the same KPI snapshot without loading the dashboard.
7. Weekly digest emails mirror that same revenue/loyalty block so concierge leads tracking inbox summaries can cite “$ impact per slug” and loyalty points without opening `/admin/reports`. Treat the email + Slack snippets as the canonical quick reference for experiment traction between deep-dive sessions.

## Exporting telemetry

### Self-serve downloads
- The admin onboarding console now ships an **Experiment export** panel directly under the KPI cards. Operators can download the latest batch (100/250/500 rows) or page deeper using the persisted `nextCursor`. The UI wraps the protected `/api/reporting/onboarding/experiment-events` route, so downloads observe operator auth + API key policies automatically.
- `/admin/reports` offers the same controls plus a “Latest rows” table rendered with server data. Use this tab when you need a quick health check on automation or to confirm schema changes landed across the stack.
- CSVs include the flattened payload documented in `docs/data-lake.md` (event/order/journey IDs, slug, variant metadata, control tags, assignment strategies, feature flags, status, recorded timestamp). Share those files with analysts when ad-hoc investigations or concierge coaching sessions need raw telemetry without waiting for the data lake refresh.
- The same CSV/NDJSON payloads now append `orderTotal`, `orderCurrency`, and `loyaltyProjectionPoints`, mirroring the in-app conversion card so downstream analytics (Snowflake, webhook sinks, Slack digests) can quote dollar impact + loyalty progress without extra joins.

### Automated pipeline
- The GitHub Action **Onboarding Experiment Export** (`.github/workflows/onboarding-experiment-export.yml`) runs on a cron and whenever triggered manually. It executes `tooling/scripts/export_onboarding_pricing_segments.py --sink webhook --cursor-store file` via Poetry, streams rows to the `ANALYTICS_SEGMENTS_WEBHOOK`, and checkpoints pagination state in `onboarding_export_cursor.json`.
- Cursor persistence is handled by syncing `onboarding_export_cursor.json` to the S3 URI defined in `ONBOARDING_EXPORT_CURSOR_S3_URI`. The workflow downloads the checkpoint before every run and uploads the updated file afterward so retries pick up exactly where the previous invocation stopped.
- Provide the following secrets before enabling the job: `ONBOARDING_EXPORT_DATABASE_URL` (points at the reporting replica), `ONBOARDING_EXPORT_API_BASE_URL` (used by FastAPI dependencies), `ANALYTICS_SEGMENTS_WEBHOOK` (Kafka/S3 bridge), and AWS credentials + region for the cursor bucket. See inline comments in the workflow for variable names.
- No DB access? Run `python tooling/scripts/export_onboarding_pricing_segments_via_api.py --limit 250 --sink file --cursor-store file --api-base-url https://api.smplat.test --api-key $CHECKOUT_API_KEY` from any environment with API+webhook reachability. It hits `/api/v1/reporting/onboarding/experiment-events` directly and emits the same payload as the DB-backed exporter.
- Optional `ONBOARDING_EXPORT_SLACK_WEBHOOK` broadcasts success/failure notifications (rows exported, next cursor, timestamps, run URL) so telemetry teams can spot automation drift without polling GitHub Actions.

### Failure & alerting
- The workflow surfaces failures in GitHub Actions; wire it into Slack/Teams notifications (Actions → Settings → Notifications) so on-call ops feels a ping when exports miss a run.
- If the export fails twice in a row or the cursor file gets stuck, check the latest run logs for DB/API connectivity errors, verify credentials/secrets, and confirm that the S3 bucket contains an up-to-date `onboarding_export_cursor.json`. Re-run the job via “Run workflow” once the secret/infra issue is fixed.
- For webhook delivery issues, the script will raise and fail the job. Consult the analytics ingestion logs (Kafka consumer, webhook target) and replay the previous cursor by editing the checkpoint file manually (ISO timestamp) before re-running the workflow.

Data teams ingest the exported rows into the `onboarding_pricing_experiment_segments` table described in `docs/data-lake.md`, ensuring BI dashboards and concierge consoles stay aligned.

## Troubleshooting checklist
- **No experiment chips** – Ensure the environment has `CHECKOUT_API_KEY` configured and that journeys have recorded pricing events. You can verify via `GET /api/v1/operators/onboarding/journeys?limit=1` and confirm the `pricingExperiments` array is populated.
- **Counts feel wrong** – Remember chips count journeys per variant, not exposures. Compare against `/api/v1/reporting/journeys/export?experimentSlug=...` once the reporting endpoints are patched.
- **Stale timestamps** – The timestamp comes from `onboarding_journey_events`. If success/account traffic is missing the `pricing_experiment_segment` event, replay the analytics proxy (`apps/web/src/lib/pricing-experiment-events.ts`) or re-run the order through the success page in a staging environment.
- **Need CSV** – Ops can pull the `/api/v1/reporting/onboarding` export once the new fields land, or request the analytics team to query the data lake table described in `docs/data-lake.md`.

## Escalation
- **Merchandising**: Ownership of variant metadata (`slug`, `variantName`, guardrails) and exposure/conversion quality.
- **Checkout/platform**: Owns `journeyContext.pricingExperiments` wiring on PDP/checkout/success.
- **Ops tooling**: Maintains the admin UI chips, KPI totals, and FastAPI filters. File issues in the operator console tracker if chips stop responding.

> meta: docs: pricing-experiments-operator-runbook
