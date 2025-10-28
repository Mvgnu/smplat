# Catalog Recommendation Services

This module encapsulates catalog-facing services that power deterministic bundle recommendations.
It orchestrates provenance-aware scoring, caching layers, and data access used by the storefront
experience.

- `experiments.py` centralizes CRUD, telemetry snapshots, and guardrail evaluation helpers.
- `guardrails.py` houses alert builders and notifier plumbing for bundle experiment automation.
