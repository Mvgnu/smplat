## Problem Statement
We need to establish foundational loyalty tiers, referral credits, and lifecycle automation across the API, worker, and storefront surfaces to unlock retention incentives.

## Metadata
Status: Investigating
Priority: High
Type: Program
Next_Target: apps/api/src/smplat_api/models/loyalty.py

## Current Hypothesis
Standing up the platform requires coordinated delivery of database models, Alembic migrations, API services, scheduled jobs, notifications, and storefront/admin integrations plus documentation and QA coverage.

## Log of Attempts (Chronological)
- 2025-05-11: Tracker initialized to drive loyalty and referral platform implementation.
- 2025-05-11: Added Alembic migration, SQLAlchemy models, service layer, FastAPI endpoints, notification templates, and shared
  TypeScript contracts to establish MVP loyalty/referral flows with documentation support.
- 2025-05-12: Delivered redemption + expiration engine (migrations, service orchestration, scheduler jobs, API contracts, tests, and runbook updates) to unlock actionable progression workflows.
- 2025-05-13: Added session-aware referral endpoints with abuse controls, storefront referral hub, shared client contracts, and updated runbook guidance; Playwright coverage extended for invite throttling.

## Resolution Summary
Pending.
