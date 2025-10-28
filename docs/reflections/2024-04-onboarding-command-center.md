# Reflection: Onboarding Command Center & Nudges

## Wins
- Operators now have a `/admin/onboarding` cockpit with risk scoring, stalled filters, and artifact visibility, removing blind spots highlighted during the last retro.
- Manual concierge nudges reuse the existing NotificationService, honoring opt-ins while logging rich interaction metadata for audit trails.
- Automated nudge detection script (`tooling/scripts/onboarding_nudges.py`) surfaces deterministic follow-ups without introducing third-party telemetry or extra tables.

## Challenges
- Balancing SQLAlchemy eager-loading with aggregation needs required additional summary helpers to avoid N+1 fetches in the console.
- Slack delivery remains a logged intent until a dedicated integration lands; documentation notes this limitation for operators.

## Improvements
- Extend nudge metadata to feed referral analytics once the social proof surfaces are online.
- Consider snapshotting aggregate counts for trend charts if operators request burn-down style reporting.
