## Problem Statement
Running `pnpm --filter @smplat/web test:unit --runInBand` under Node 20 produces six failing suites. The most critical blocker is the mocked `better-sqlite3` implementation throwing `Unsupported all statement: PRAGMA table_info(rehearsal_actions)`, which breaks every marketing preview history test. Additional failures include `useMarketingPreviewHistory` expecting two network calls but receiving three, and several cart store assertions that no longer match the current reducer behavior.

## Metadata
Status: Resolved  
Priority: High  
Type: Test  
Next_Target: Update sqlite mock + verify cart store behavior

## Current Hypothesis
1. New history store logic introduced `PRAGMA table_info` introspection that the Jest mock doesn’t understand; adding support for that statement should unblock all rehearsal-history test suites.
2. The marketing preview hook now performs an extra fetch (likely prefetching governance metadata); the test expectations need to align with the latest behavior.
3. Cart store tests assume quantity mutations and persistence semantics that may have changed—either the store needs bug fixes or the tests must be updated to follow the new API surface.

## Log of Attempts (Chronological)
- 2025-10-31T12:18: Executed test suite via `nvm use 20 && pnpm --filter @smplat/web test:unit --runInBand`; observed failures listed above.
- 2025-10-31T12:42: Re-ran tests under Node 20 after reinstalling dependencies; failures persist with identical stack traces (sqlite PRAGMA mock, marketing preview fetch count, cart store assertions).
- 2025-11-13T01:29: Refined `useMarketingPreviewHistory` caching so successful “all” responses are stored (only when `actionMode` is undefined and pagination is reset) and primed into the client cache when reverting from rehearsal/live filters. Updated the rehearsal test fixture to include the missing `verdict` data so the zod schema accepts the mocked payload. Targeted suite `pnpm --filter @smplat/web test:unit -- useMarketingPreviewHistory` now passes, leaving the sqlite mock and cart store issues as the remaining blockers.
- 2025-11-13T02:10: Extended provider-aware add-on serialization (TypeScript + API schemas) so preview quantities, payload templates, and service rules flow end-to-end, then broadened normalization in `catalog/products.ts` and order-mapping logic. The full Jest suite (`pnpm --filter @smplat/web test:unit --runInBand`) now passes, so the original marketing preview/cache and cart selections issues are cleared.

## Resolution Summary
Marketing preview history caching now reuses the stored “all” results, the provider catalog metadata (preview quantities, payload templates, service rules) persists through admin serialization and API schemas, and the Jest suite is clean, eliminating the previously blocked tests.
