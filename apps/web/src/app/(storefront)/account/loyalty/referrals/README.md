# Loyalty referrals route

This route renders the member-facing referral management experience under
`/account/loyalty/referrals`. Server components load referral invites plus
predictive segmentation + velocity telemetry, while the client component handles
invite creation, sharing, cancellation, and insight rendering with optimistic
updates.
