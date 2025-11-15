# Provider Automation Export Runbook

Use this guide to keep the `provider_automation_runs` table synced into data warehouses or S3 buckets.

## Command Options

- `pnpm automation:export-runs -- --limit 200 --format csv`
  - Runs the Poetry-backed exporter (from repo root). The script automatically honors:
    - `SMPLAT_API_BASE_URL` (defaults to `http://localhost:8000`)
    - `SMPLAT_AUTOMATION_EXPORT_DIR` (when set, writes timestamped files automatically)
    - `SMPLAT_AUTOMATION_AUTH_TOKEN` (optional bearer token)
  - Use CLI flags to override (e.g., `--base-url`, `--output`) per invocation.
  - Output rows now include both `alerts_digest` and `load_alerts_digest` so warehouses retain the preset/provider deep links emitted by the automation worker.
- `tooling/scripts/provider_automation_export.sh`
  - Shell wrapper for cron/CI. Honors:
    - `SMPLAT_API_BASE_URL` (default `http://localhost:8000`)
    - `SMPLAT_AUTOMATION_EXPORT_DIR` (default `exports/`)
    - `SMPLAT_AUTOMATION_AUTH_TOKEN` (optional secret injected token)
  - Writes timestamped JSON files like `exports/provider_automation_runs_20250113T010000Z.json`.

## Recommended Cron Job

```cron
# hourly export to /var/exports/provider_runs_*.json
0 * * * * cd /srv/smplat && \
  SMPLAT_API_BASE_URL="https://api.smplat.prod" \
  SMPLAT_AUTOMATION_EXPORT_DIR="/var/exports" \
  ./tooling/scripts/provider_automation_export.sh
```

- Point your warehouse ingest to the export directory (S3 sync, rsync, etc.).
- Pass `--auth-token` arguments via the wrapper if the API requires bearer auth:
  - `SMPLAT_AUTOMATION_AUTH_TOKEN` env var is automatically forwarded to the exporter,
    or pass `--auth-token "$SMPLAT_API_TOKEN"` explicitly if you prefer CLI arguments.

## Monitoring

- The script exits non-zero on HTTP or CLI errors, making it cron-friendly.
- Consider pairing with a log shipper or simple `|| logger "failed"` hook for alerting.

## GitHub Actions Integration

- Workflow: `.github/workflows/provider-automation-export.yml`
  - Triggers hourly via cron and can be run manually (`workflow_dispatch`).
  - Matrix target runs for `staging` (test) and `production` environments.
  - Each environment must define:
    - Variable `SMPLAT_API_BASE_URL` pointing at the respective API host.
    - Variable `SMPLAT_AUTOMATION_EXPORT_DIR` (optional) overriding the default `exports/<target>` path.
    - Secret `SMPLAT_AUTOMATION_API_TOKEN` containing the bearer token used by the exporter.
  - Adjustable repository/environment variables:
    - `SMPLAT_AUTOMATION_EXPORT_LIMIT` (defaults to 200)
    - `SMPLAT_AUTOMATION_EXPORT_FORMAT` (defaults to `json`)
  - Artifacts named `provider-automation-runs-<target>` contain the timestamped exports for downstream ingest.
- Use this workflow when you need a SaaS-friendly export loop (no cron host required). Update the variables/secrets
  per environment before enabling the schedule to avoid validation failures.
