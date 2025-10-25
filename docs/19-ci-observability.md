# CI Integration for Observability Smoke Tests

This playbook shows how to incorporate the new observability scripts into your CI/CD pipeline so every deployment validates telemetry before promotion.

## Pre-requisites

- A Python 3.11+ runtime available in your CI environment.
- Access to the checkout API key (`CHECKOUT_API_KEY`) stored as a secret.
- Network access from CI runners to the target environment (e.g., staging API URL).

## Repository Workflow

This repository now ships with `.github/workflows/observability-checks.yml`, which wraps `tooling/scripts/check_observability.py` and enforces the observability thresholds before promotion.

To enable the workflow:

- Add a repository secret `CHECKOUT_API_KEY` containing the staging checkout key.
- Create a repository variable `OBSERVABILITY_BASE_URL` with the staging API origin (for example `https://staging-api.example.com`).
- (Optional) Set repository variables for thresholds: `MAX_FULFILLMENT_DEAD_LETTERED`, `MAX_FULFILLMENT_FAILED`, `MAX_PAYMENT_CHECKOUT_FAILURES`, `MAX_PAYMENT_WEBHOOK_FAILURES`, `CATALOG_MAX_ZERO_RESULTS_RATE`, `CATALOG_MIN_SAMPLE_SIZE`.
- (Optional) Set `SKIP_CATALOG` to `true` until catalog search telemetry is live in staging (the zero-result SLO check is skipped automatically when sample size is below `CATALOG_MIN_SAMPLE_SIZE`).
- The workflow now installs dev dependencies via Poetry and runs the catalog observability pytest suite before executing runtime checks. Keep `pyproject.toml`'s dev group aligned with test needs.
- Successful runs export Markdown/JSON catalog insights and upload them as a `catalog-insights` artifact for merchandising.

The workflow targets the `staging` environment and runs on pushes to `main` as well as `workflow_dispatch`. Adjust triggers or thresholds directly in the YAML if your deployment cadence differs.

## GitHub Actions Example

```yaml
name: observability-checks

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/api
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Install Poetry
        run: python -m pip install --upgrade pip poetry

      - name: Install dependencies
        run: poetry install --with dev

      - name: Run catalog observability tests
        run: poetry run pytest tests/test_observability.py -k catalog

  observability:
    needs: api-tests
    runs-on: ubuntu-latest
    env:
      API_BASE_URL: https://staging-api.example.com
      CHECKOUT_API_KEY: ${{ secrets.CHECKOUT_API_KEY }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Install API dependencies
        working-directory: apps/api
        run: |
          python -m venv .venv
          .venv/bin/pip install --upgrade pip
          .venv/bin/pip install -e .

      - name: Run observability checks
        run: |
          apps/api/.venv/bin/python tooling/scripts/check_observability.py \
            --base-url "$API_BASE_URL" \
            --api-key "$CHECKOUT_API_KEY" \
            --max-fulfillment-dead-lettered 0 \
            --max-payment-checkout-failures 0 \
            --max-payment-webhook-failures 0 \
            --max-catalog-zero-results-rate 0.2 \
            --catalog-min-sample-size 10

      - name: Export catalog insights (Markdown)
        run: |
          apps/api/.venv/bin/python tooling/scripts/export_catalog_insights.py \
            --base-url "$API_BASE_URL" \
            --api-key "$CHECKOUT_API_KEY" \
            --format md \
            --output catalog-insights.md

      - name: Export catalog insights (JSON)
        run: |
          apps/api/.venv/bin/python tooling/scripts/export_catalog_insights.py \
            --base-url "$API_BASE_URL" \
            --api-key "$CHECKOUT_API_KEY" \
            --format json \
            --output catalog-insights.json

      - uses: actions/upload-artifact@v3
        with:
          name: catalog-insights
          path: |
            catalog-insights.md
            catalog-insights.json
```

## GitLab CI Snippet

```yaml
observability:
  stage: test
  image: python:3.13
  script:
    - python -m venv apps/api/.venv
    - apps/api/.venv/bin/pip install -e apps/api
    - apps/api/.venv/bin/python tooling/scripts/check_observability.py \
        --base-url "$STAGING_API_BASE_URL" \
        --api-key "$CHECKOUT_API_KEY" \
        --max-fulfillment-dead-lettered 0 \
        --max-payment-checkout-failures 0 \
        --max-payment-webhook-failures 0 \
        --max-catalog-zero-results-rate 0.2 \
        --catalog-min-sample-size 10
  variables:
    CHECKOUT_API_KEY: $CHECKOUT_API_KEY
    STAGING_API_BASE_URL: https://staging-api.example.com
```

## Alert Thresholds

Tune the CLI thresholds to match your SLOs:

- `--max-fulfillment-dead-lettered`: set this to 0 or 1 depending on tolerance.
- `--max-payment-checkout-failures`: keep low (e.g., <= 1) to ensure Stripe checkout remains healthy.
- `--max-payment-webhook-failures`: set to a small buffer (0–2) to catch webhook regressions quickly.
- `--max-catalog-zero-results-rate`: align with catalog SLOs (default 0.2). Tighten once catalog coverage is stable.
- `--catalog-min-sample-size`: prevents noisy alerts when only a handful of catalog searches have occurred (default 10).

## Local Dry Run

Before wiring CI, run the suite locally:

```bash
cd apps/api
poetry install --with dev
poetry run pytest tests/test_observability.py -k catalog

poetry run python ../tooling/scripts/check_observability.py \
  --base-url http://localhost:8000 \
  --skip-catalog \
  --max-catalog-zero-results-rate 0.2 \
  --catalog-min-sample-size 10
```

Generate a quick report for the marketing team:

```bash
poetry run python ../tooling/scripts/export_catalog_insights.py \
  --base-url http://localhost:8000 \
  --api-key "$CHECKOUT_API_KEY" \
  --format md \
  --output ./catalog-insights.md
```

Share the resulting Markdown/JSON in experiment briefs or import into spreadsheets for deeper analysis.

> **Test dependencies:** Run `poetry install` (or `python -m pip install -e .[dev]` if you prefer `pip`) inside `apps/api` before executing `pytest` so plugins such as `pytest-asyncio` are available for the catalog observability suite.
>
> **Workflow artifact:** After each run, download the `catalog-insights` artifact from the workflow summary to grab the Markdown/JSON exports without rerunning the script manually.

## Notification Delivery Coverage

- The transactional notification suite now renders Markdown + HTML bodies for payment receipts, fulfillment retries, completion summaries, and weekly digests. Back-end tests (`poetry run pytest`) exercise these templates end-to-end against the in-memory SMTP backend so CI catches regressions in copy, metadata, or preference gating.
- When SMTP credentials are absent (typical in local/dev CI), `NotificationService` automatically substitutes the in-memory backend; tests assert both text and HTML parts so template coverage does not rely on infrastructure.
- Preferences are enforced per event type (`payment_updates`, `fulfillment_alerts`, `marketing_messages`). Pipelines inherit the new tests that verify opt-outs remain respected even as fulfillment/payment services trigger the additional events.

## Weekly Digest Scheduling

- The API boots a lightweight scheduler that calls `WeeklyDigestDispatcher` on a configurable interval. Toggle it via `WEEKLY_DIGEST_ENABLED=true` and adjust cadence with `WEEKLY_DIGEST_INTERVAL_SECONDS` (default: one week). Use `WEEKLY_DIGEST_DRY_RUN=true` in staging to keep dispatches in memory while verifying logs/metrics.
- Deployments without a long-running API worker can trigger the same flow through `tooling/scripts/run_weekly_digest.py` inside cron, GitHub Actions, or other orchestrators. Pass `--dry-run` to reuse the in-memory backend for verification runs.
