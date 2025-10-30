# Loyalty Hub Route

This directory hosts the storefront loyalty hub surface exposed at `/account/loyalty`.

- `page.tsx` fetches loyalty member snapshots and reward catalog entries using server-side hydration. When no checkout API key is configured the page transparently falls back to local maintenance fixtures so end-to-end coverage can run without live dependencies.
- `loyalty.client.tsx` renders the tier progress, proactive nudge rail, balances, expiring points, activity timeline, referral conversion summary, and reward catalog UI with optimistic redemption handling and cross-links into the referral hub. The activity timeline accepts filters for referral code, campaign slug, and checkout order to help members trace specific outcomes (e.g., guardrail overrides or checkout nudges).
- `loyalty.actions.ts` encapsulates server actions that call the upstream loyalty API (or maintenance fixtures when the checkout API key is absent) when members redeem rewards or issue/cancel referrals.
- `referrals/page.tsx` + `referrals.client.tsx` render the member-facing referral invite manager, including rate-limit feedback, predictive segmentation, velocity insights, share links, and cancellation controls.

Playwright coverage for this surface lives in `apps/web/tests/e2e/loyalty-hub.spec.ts`.
