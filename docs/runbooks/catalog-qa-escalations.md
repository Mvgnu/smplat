# Catalog QA Escalation Macros

When merchandising QA uncovers a pricing, content, or guardrail anomaly that requires real-time coordination, use these Slack-ready snippets. They keep every escalation aligned with the guardrail conversion context now surfaced in `/admin/reports` and `/admin/fulfillment/providers`.

## When to use

- Catalog or merchandising checks detect storefront regressions (pricing mismatches, missing assets, disabled platforms) that require provider action.
- Guardrail follow-ups logged in `/admin/reports` still need merchandising-specific notes for product owners.
- Automation digests already fired, but merchandising wants to share additional screenshots/logs without losing conversion context.

## Required context

1. Open `/admin/reports` and ensure the experiment analytics card shows the desired conversion slice.
2. Copy the conversion deeplink using the “Open conversions” button:
   - If the banner displays “Historical cursor …”, copy the `conversionCursor` from the query string (e.g., `2024-12-01T22:30:00Z`).
   - Otherwise treat the snapshot as “Live”.
3. Grab the provider guardrail URL (`/admin/fulfillment/providers/{id}?tab=automation`) to reference the follow-up timeline.
4. Note the latest guardrail action + notes to include in the escalation summary.

## Slack macro

```
:warning: Catalog QA escalation – *{providerName}* `{providerId}`
• Issue: {short symptom summary}
• Guardrail action: {lastFollowUpAction} · Notes: {lastFollowUpNotes}
• {Live/Historical} conversion slice{cursorHint}: <https://app.smplat.local/admin/reports{?conversionCursor=...}#experiment-analytics|Open conversions>
• Follow-up timeline: <https://app.smplat.local/admin/fulfillment/providers/{providerId}?tab=automation|Open provider>
• Attachments: {screenshots/log links}
```

- Replace `{Live/Historical}` with “Historical” whenever a `conversionCursor` is present, appending `(cursor {value})` so recipients know the slice’s timestamp.
- Keep issue summaries concise (“Missing preset assets in Instagram carousel”, “Variant price mismatch after deploy”).
- Always include the provider link even when the escalation targets merchandising—the guardrail feed is now the common source of truth.

## Tips

- Use the same macro when opening PagerDuty/Teams tickets; copy/paste preserves the deeplinks and cursor context.
- If multiple providers are impacted, create one block per provider to keep guardrail references unambiguous.
- Reference this macro in Confluence/email whenever catalog QA playbooks mention Slack so the conversion context requirement remains consistent.
- `/admin/reports` exposes a **Copy escalation snippet** button on every guardrail alert; click it to grab this template with the provider ID, latest follow-up, cursor label, and deeplinks pre-filled. The snippet automatically pulls the platform context from the alert’s primary chip—adjust the text only if you need to highlight a different surface.
