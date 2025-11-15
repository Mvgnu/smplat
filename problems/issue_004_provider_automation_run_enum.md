## Problem Statement
`poetry run alembic upgrade head` failed before reaching the media asset enrichment revision because `provider_automation_run_type_enum` was created twice when Alembic executed migrations in dual contexts, raising `psycopg2.errors.DuplicateObject`.

## Metadata
Status: Resolved
Priority: Medium
Type: Build
Next_Target: apps/api/alembic/versions/20251212_41_provider_automation_runs.py
Last_Tool: `poetry run alembic upgrade head`

## Current Hypothesis
Alembic spins up two migration contexts (offline + online) for this project, so bare `postgresql.ENUM.create(checkfirst=True)` is not safe—both contexts race to create the enum inside their own transactions, producing a duplicate type error. We need idempotent DDL that tolerates repeated execution.

## Log of Attempts (Chronological)
- 2025-11-14T14:32Z — Hypothesis: checkfirst=True should skip creation if type exists. Action: reran migration with original script, failure reproduced. Finding: both contexts still attempt creation.
- 2025-11-14T14:35Z — Hypothesis: explicit SELECT guard before `create()` will prevent duplicates. Action: added `SELECT pg_type` check. Outcome: both contexts read `pg_type` before either commits, still race and fail.
- 2025-11-14T14:38Z — Hypothesis: wrapping creation in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` will swallow duplicates. Action: added DO block but column still used `sa.Enum` which triggered its own CREATE TYPE, so failure persisted.
- 2025-11-14T14:41Z — Hypothesis: use Postgres enum type object with `create_type=False` for the column so no implicit CREATE TYPE fires, and keep DO block with duplicate handling. Action: updated migration accordingly and reran `poetry run alembic upgrade head`. Result: migrations completed through 20251215_42 without errors.

## Resolution Summary
Ensure the enum is created via a DO block that catches `duplicate_object`, and reference it using a `postgresql.ENUM(..., create_type=False)` column so Alembic can run migrations twice without conflicting DDL.
