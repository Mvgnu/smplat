## Problem Statement
`poetry run ruff check` reports 26 pre-existing lint errors across multiple modules unrelated to the current security hardening changes.

## Metadata
Status: Open
Priority: Medium
Type: Lint
Next_Target: apps/api/src/smplat_api/services

## Current Hypothesis
The FastAPI project has an outstanding lint backlog (unused imports, undefined names, and ordering issues) that predates the new lockout service. Addressing it requires dedicated cleanup separate from the current security tasks.

## Log of Attempts (Chronological)
- 2025-02-14 00:00Z: Ran `poetry run ruff check`; tool reported 26 errors spanning alembic, services, models, and tests. No fixes applied during this iteration.

## Resolution Summary
Pending.
