## Problem Statement
Prisma schema initialization against the local Postgres instance fails. `prisma migrate deploy` aborts with `P3018` because the migration tries to create indexes on `onboarding_journey_events`, which does not exist in a fresh database. Running `prisma db push` after resetting the schema also errors: Postgres reports `foreign key constraint "accounts_user_id_fkey" cannot be implemented` because Prisma generates `TEXT` columns for relation fields while the referenced IDs are `UUID`.

## Metadata
Status: Resolved  
Priority: High  
Type: Build  
Next_Target: Align Prisma schema with local Postgres (either via corrected SQL bootstrap or datamodel adjustments)

## Current Hypothesis
The repository is missing an initial Prisma migration that creates the `onboarding_journey_events` table and sets all foreign-key columns to `UUID`. Without that baseline, fresh databases cannot be provisioned purely via `prisma migrate deploy`. We likely need to bootstrap the schema manually (e.g., via a generated SQL diff with column-type corrections) before Prisma migrations can be marked as applied.

## Log of Attempts (Chronological)
- 2025-10-31T11:32: Ran `pnpm --filter @smplat/web exec prisma migrate deploy` (DB url `postgresql://smplat:smplat@localhost:55432/smplat`) → failed with `P3018` (`relation "onboarding_journey_events" does not exist`).
- 2025-10-31T11:38: Executed `prisma db push` after dropping `public` schema → failed with Postgres error `foreign key constraint "accounts_user_id_fkey" cannot be implemented` due to `TEXT` vs `UUID` mismatch on relation columns.
- 2025-10-31T11:44: Generated SQL via `prisma migrate diff --from-empty --to-schema-datamodel` to inspect column definitions. Confirmed relation columns (e.g., `accounts.user_id`) are emitted as `TEXT`, explaining the foreign key mismatch.
- 2025-10-31T11:55: Added `@db.Uuid` annotations to relation fields in `apps/web/prisma/schema.prisma` so Prisma generates UUID columns for foreign keys. Ran `prisma db push` successfully with escalated permissions.
- 2025-10-31T12:02: Baseline migration history via `prisma migrate resolve --applied 202510300001_add_offer_and_onboarding_events`; verified `prisma migrate deploy` now reports no pending migrations.

## Resolution Summary
Annotated all relation field columns with `@db.Uuid`, allowing Prisma to synthesize matching UUID column types in Postgres. Applied the schema with `prisma db push`, then marked the existing migration as applied so future `prisma migrate deploy` runs succeed.
2025-12-03 Update: Prisma has since been fully removed from `apps/web`; ongoing identity storage relies on FastAPI endpoints, so no additional work is required on this tracker.
