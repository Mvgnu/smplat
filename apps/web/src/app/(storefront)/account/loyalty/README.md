# Loyalty Hub Route

This directory hosts the storefront loyalty hub surface exposed at `/account/loyalty`.

- `page.tsx` fetches loyalty member snapshots and reward catalog entries using server-side hydration. It falls back to stub data when `NEXT_PUBLIC_E2E_AUTH_BYPASS=true` to enable Playwright coverage without real authentication.
- `loyalty.client.tsx` renders the tier progress, balances, expiring points, and reward catalog UI with optimistic redemption handling and cross-links into the referral hub.
- `loyalty.actions.ts` encapsulates server actions that call the upstream loyalty API (or stubs for e2e runs) when members redeem rewards or issue/cancel referrals.
- `referrals/page.tsx` + `referrals.client.tsx` render the member-facing referral invite manager, including rate-limit feedback, share links, and cancellation controls.

Playwright coverage for this surface lives in `apps/web/tests/e2e/loyalty-hub.spec.ts`.
