# Security Access Audit Console

The `/admin/security` workspace provides real-time visibility into access policy decisions recorded by the middleware and role
policies. Use this console to triage escalations and communicate status back to operators.

## Dashboards

- **KPI Grid** – summarizes denied, redirected, and rate-limited attempts over the rolling 24-hour window alongside the number
  of unique identities observed. The "targeting admin surfaces" footer highlights how many denials attempted to cross the admin
  tier gate.
- **Escalations to review** – prioritizes the most recent non-member denials and rate-limit events. Each entry shows the
  identity, route, timestamp, and recorded reason for quick follow-up.
- **Access trail** – exposes the last 75 access events (allowed and denied) with metadata payloads. Use this table when exporting
  evidence for incident reviews or correlating with external logging pipelines.

## Operating Guidance

1. **Eligibility** – Only accounts with the `ADMIN` role can view this dashboard. The sidebar nav adds the Security link when the
   session role qualifies. Attempted access by lower tiers is recorded in the audit stream and surfaces as an escalation.
2. **Response Loop** – When an escalation warrants action, assign follow-up in the security ops tracker and note the corresponding
   `access_events.id`. Use the metadata column to correlate IP/device fingerprints captured by middleware.
3. **Window Controls** – The default window spans 24 hours. Update the `fetchAccessEventMetrics` invocation in
   `security/page.tsx` if extended retention is required. For ad-hoc analysis beyond the UI window, query the `access_events`
   table directly with the `required_tier` and `decision` fields.
4. **Maintenance Tokens** – During sanctioned maintenance windows, distribute signed maintenance tokens via the service account
   tooling. Successful maintenance access should still appear as `allowed` events with the `serviceAccountId` populated.

## Future Enhancements

- Wire the event stream into the notification system once security paging is in place.
- Enrich metadata with geolocation and device heuristics to accelerate anomaly triage.
- Add export and filtering controls for longer investigations and compliance evidence.
