# Loyalty referrals route

This route renders the member-facing referral management experience under
`/account/loyalty/referrals`. Server components load referral invites via the
shared loyalty lib, while the client component handles invite creation,
sharing, and cancellation with optimistic updates.
