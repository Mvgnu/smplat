# Customer Performance Dashboard Plan

Blueprint for the storefront-facing “Performance” dashboard that combines conversion telemetry, guardrail follow-ups, loyalty lift, and social automation insights.

## Goals

1. Provide concierge and customer operators with a single pane of glass to audit experiment performance, guardrail posture, and platform engagement without juggling `/admin/reports`, `/admin/fulfillment/providers`, or spreadsheet exports.
2. Reuse proven admin components (conversion snapshots, guardrail timelines, automation badges) so the UI stays consistent with internal tooling and minimizes net-new engineering.
3. Document API + data dependencies up-front so Snowflake exports and future warehouse explores can power both the dashboard and downstream BI without duplication.

## Information Architecture

1. **Hero KPI strip** (full-width, stacked on mobile)
   - Total revenue vs. previous period, conversion rate, guardrail pauses/resumes, loyalty points earned, automation SLA badge.
   - Mirrors `/admin/reports` conversion cards but swaps operator copy for customer-friendly labels (“Performance snapshot”, “Guardrail actions logged”).
2. **Conversion & experiment trends**
   - Left column (~60% width): sparkline view of top experiments (slug + variant) with trailing 7/30-day comparisons and CTA to open `/admin/reports#experiment-analytics`.
   - Right column (~40%): “Conversion timeline” showing cursor-aware slices. Include “Live vs. Historical” hints just like the admin UI.
3. **Guardrail posture**
   - Grid of provider cards with status badges, most recent follow-up entry, and CTA to “View timeline”.
   - Embeds a condensed `GuardrailFollowUpTimeline` (top 3 entries) and `AutoGuardrailActionChip` for any automation-driven pauses/resumes.
4. **Loyalty & retention**
   - Section summarizing loyalty tier mix, referrals, and upcoming account reminders (reuse `/admin/reports` loyalty panel components).
5. **Platform & social metrics**
   - Table with platform contexts (Instagram, Shopify, TikTok, etc.) showing engagement deltas, queued automation runs, and open follow-ups.
   - Placeholder slot for future “Post planner” metrics (publish queue, best-performing content) so design accommodates future data sources.
6. **Action drawer**
   - Collapsible drawer that reuses `/admin/reports` “Log follow-up” component for concierge-only workflows (hidden for customers without guardrail permissions).

## Widget Requirements

- Every widget must declare:
  - Data source (API endpoint, Snowflake view, exporter artifact).
  - Refresh cadence and cursor semantics.
  - Permission gates (customer vs. concierge vs. admin).
- KPI strip: requires `ExperimentConversionSnapshotResponse` + loyalty deltas (`/api/v1/reporting/loyalty/projection`).
- Guardrail posture: needs `GET /api/v1/reporting/guardrails/alerts`, follow-up timelines, automation status from `/api/v1/fulfillment/providers/automation/status`.
- Platform metrics: aggregated from Snowflake table `analytics.guardrail_followups` (new), `analytics.provider_load_alerts`, and social engagement feed.
- Action drawer: reuses `GuardrailAlertActions` with provider-aware context to avoid duplicating follow-up logging logic.

## Data Dependencies

| Dependency | Source | Notes |
| --- | --- | --- |
| Conversion snapshots | `/api/v1/reporting/onboarding/experiment-conversions` | Already exposes cursors and links used by admin UI; reuse same handler. |
| Guardrail follow-ups | `/api/v1/reporting/guardrails/followups` + Snowflake table from `export_guardrail_followups.py` | Timeline queries hit FastAPI; warehouse copy supports trend charts + Looker explores. |
| Guardrail alerts | `/api/v1/reporting/guardrails/alerts` | Powers the posture grid + quick actions. |
| Automation status | `/api/v1/fulfillment/providers/automation/status` | Provides SLA badge + action chips. |
| Loyalty tiers & referrals | `/api/v1/reporting/loyalty/tiers` / `/api/v1/loyalty/referrals` | Displayed in loyalty section; include projections + points earned. |
| Platform account tracking | `/api/v1/fulfillment/providers/platform-contexts` | Ensures cards show consistent platform IDs/labels. |
| Social media metrics | `analytics.social_profiles_daily` (warehouse) | Contains follower/engagement deltas per platform; initial version may use mock data until connectors land. |
| Future post planner | Placeholder referencing `analytics.post_planner_events` | Documented for future epics; highlight dependency gap. |

## Component Reuse & Gaps

- **Reuse**
  - `ExperimentMetricsPanel`, `ConversionSnapshotCard` from `/admin/reports/page.tsx`.
  - `GuardrailFollowUpTimeline`, `GuardrailAlertActions`, `AutoGuardrailActionChip` for posture + action logging.
  - `ProviderStatusBadge` / automation history summary from `/admin/fulfillment/providers`.
- **Missing APIs**
  - Customer-safe read endpoint for guardrail alerts (`/api/v1/reporting/guardrails/alerts` requires checkout API key today). Need scoped token/role gating.
  - Aggregated loyalty/retention endpoint that merges tier mix + referral stats into a single payload.
  - Social metric proxy to avoid exposing analytics warehouse credentials directly to the dashboard.
- **Next steps**
  1. Finalize API contract for customer-safe guardrail feed (include provider_id, status, latest follow-up summary).
  2. Build Snowflake view `analytics.guardrail_followups_daily` (counts per provider/platform) for charting.
  3. Prototype dashboard layout in Storybook using existing admin components to validate sizing.
  4. Align with analytics team on Looker explores for guardrail follow-ups and conversion cursor analysis; reference the SQL snippet in `docs/data-lake.md`.
