#!/usr/bin/env bash
# Convenience wrapper to export provider automation run history on a schedule.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${SMPLAT_API_BASE_URL:-http://localhost:8000}"
OUTPUT_DIR="${SMPLAT_AUTOMATION_EXPORT_DIR:-exports}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$OUTPUT_DIR"

OUTPUT_FILE="$OUTPUT_DIR/provider_automation_runs_${TIMESTAMP}.json"

echo "[provider-automation-export] exporting runs from ${BASE_URL} -> ${OUTPUT_FILE}"
pnpm automation:export-runs -- --base-url "${BASE_URL}" --output "${OUTPUT_FILE}" "$@"
echo "[provider-automation-export] ✅ complete"
