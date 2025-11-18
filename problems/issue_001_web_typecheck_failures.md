## Problem Statement
`pnpm --filter @smplat/web typecheck` fails with dozens of TypeScript errors across merchandising admin, storefront tests, checkout flows, and client components. The failure blocks verification of the new onboarding analytics work because `tsc` exits after surfacing unrelated issues (e.g., undefined helpers in `ProductsClient.tsx`, stale journey draft types, invalid test mocks).

## Metadata
- Status: Open
- Priority: High
- Type: Build
- Last_Tool: `pnpm --filter @smplat/web typecheck`
- Next_Target: Review & triage legacy errors in `apps/web/src/app/(admin)/admin/products/ProductsClient.tsx` before addressing storefront test failures.

## Current Hypothesis
The web workspace accumulated partially migrated merchandising/admin code and outdated storefront tests; they were committed before the onboarding analytics work and now trigger `tsc --noEmit` failures. Resolving them likely requires revisiting the merchandising product editor (missing preview helpers, incorrect type predicates) and updating several storefront test utilities to match the latest APIs.

## Log of Attempts (Chronological)
1. **Run 1 – `2025-01-05T18:20:00Z`**  
   - *Hypothesis*: Only the newly touched onboarding files might cause type errors.  
   - *Action*: Executed `pnpm --filter @smplat/web typecheck`.  
   - *Findings*: ~20 errors reported before truncation. Examples:  
     - `apps/web/src/app/(admin)/admin/merchandising/option-matrix-editor.tsx` – visibility serialization + validation builder types inferred incorrectly.  
     - `apps/web/src/app/(admin)/admin/merchandising/page.tsx` – duplicate `topPresets` constants and missing blueprint provider types.  
     - `apps/web/src/app/(admin)/admin/products/ProductsClient.tsx` – add-on pricing union misuse, undefined `previewConfigurationPresets`, strict type predicates.  
     - Numerous storefront test suites (`account/orders`, `checkout`, `products/[slug]`) referencing outdated helper signatures.  
   - *Outcome*: Confirmed failures originate from pre-existing merchandising + storefront files; new onboarding code cannot be validated until these are triaged. Tracker opened to document scope.

## Resolution Summary
_Pending._
