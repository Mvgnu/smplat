## Problem Statement
Bundle experimentation lacks production-ready guardrails, scheduling, storefront integration, and validation tooling. To safely launch bundle tests we must backfill telemetry, automate guardrail enforcement, expose experiment context to the storefront, and deliver QA tooling.

## Metadata
Status: Investigating
Priority: High
Type: Program
Next_Target: apps/api/tests/catalog/test_catalog_experiments.py

## Current Hypothesis
Delivering maturity requires phased work: (1) data integrity and guardrails (backfills, workers, schedules, documentation), (2) lifecycle validation (automated tests, QA seeds, smoke checks), (3) storefront exposure (loader + UI fallbacks), and (4) operator tooling (admin enhancements, permissions, audit logs). Each slice can land independently but should preserve a coherent end-to-end story.

## Log of Attempts (Chronological)
- 2025-05-10: Tracker initialized to capture bundle experimentation maturity effort and ensure follow-up tasks remain visible between sessions.
- 2025-05-10: Reinstated API guardrail wiring, settings toggles, worker exports, and documentation after accidental checkout wiped changes; queued pytest + storefront unit runs.
- 2025-05-10: Introduced catalog job scheduler (APScheduler-backed) with TOML cron definitions for acceptance aggregation + guardrail evaluation; expanded API tests and runbook guidance to confirm automation cadence.

## Resolution Summary
Pending.
- 2025-05-10: Added `tooling/scripts/backfill_bundle_experiments.py` for idempotent telemetry backfills (supports dry runs + adjustable lookback).
- 2025-05-10: Added `BundleExperimentGuardrailWorker` with Slack/email alerting + lifecycle wiring to pause breached experiments automatically.
- 2025-05-10: Delivered QA seeding script (`tooling/scripts/seed_bundle_experiments.py`) to provision deterministic experiments + metrics.
- 2025-05-10: Wired storefront product detail page to surface experiment overlays, guardrail warnings, and variant telemetry using new client utilities and tests.
