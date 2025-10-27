# Marketing Preview Components

This folder contains interactive components that power the marketing preview cockpit within the admin surface.

- `PreviewWorkbench.tsx` – timeline-aware workspace for navigating routes, comparing draft/published snapshots, triaging regressions, and documenting notes.

Components in this directory assume marketing preview snapshots are collected through `@/server/cms/preview`. Keep metadata comments (`key: value`) up to date so automation can track features.

## Timeline & triage workflow

The workbench consumes `collectMarketingPreviewSnapshotTimeline` output, which includes the current capture and prior manifests. Editors can scrub through captures via the left sidebar timeline, review per-route diff badges, and open regression notes for the active route. Notes are persisted through the `/api/marketing-preview/notes` endpoint and stored locally for development under `apps/web/src/server/cms/__fixtures__/marketing-preview-notes.json`.

- Use the severity selector to categorize issues (`info`, `warning`, or `blocker`).
- Notes are grouped by `generatedAt` + route and surface counts directly in the route navigation to guide triage.
- Timeline history is sourced from `marketing-preview-history.json`; running the snapshot writer appends new entries automatically.

## Live streaming & validation loop

- `useLivePreview.ts` opens an SSE connection to `/api/marketing-preview/stream` and merges incoming payloads into the current timeline entry. When offline, the hook gracefully falls back to the last persisted snapshot.
- The SSE handler verifies `PAYLOAD_LIVE_PREVIEW_SECRET`, normalizes Lexical content, renders markup with `MarketingSections`, and validates each block via `validateMarketingBlock`.
- Live activity appears in the workbench header, per-route badges, and the validation feed. Editors can clear the feed after triage for a clean slate.
- Diagnostics are persisted per route through the live stream. `useLivePreview` maintains a rolling ledger per variant that compares the latest diagnostics with the previous snapshot so regressions are obvious. Each ledger entry captures block-level diff metadata (added, removed, regressed, improved) and maintains a fingerprint buffer so recurring issues surface immediately.
- `BlockDiagnosticsPanel.tsx` renders the ledger summary, diff clusters, section-level warnings, and detailed block traces. Diff clusters retain a rolling history of block fingerprints, trace hashes, and severity changes so regression streaks are visible at a glance. Editors can copy Payload paths, inspect fallback provenance, or reprioritize fallbacks from the cockpit without leaving the workbench. Structured recovery hints now map into remediation playbooks that outline Payload deep links and fixture provenance for guided triage.
- Variant selectors in the workbench allow switching between baseline and audience variants. Drift metrics and "since last green" summaries highlight whether a variant has recovered. Regression hotspots are aggregated across variants to flag the riskiest blocks.
- `/api/marketing-preview/fallbacks` accepts authenticated `reset` and `prioritize` actions, updating in-memory counters for governance monitoring while respecting the privacy requirement (no personal telemetry is stored).

## Diff overlays & cluster semantics

- Ledger entries now feed a diff-cluster engine that records the latest status (`added`, `removed`, `regressed`, `improved`, `steady`) alongside a severity sparkline per block. The heatmap in the diagnostics panel depicts the eight most recent severity points (0 = clean, 1 = warnings, 2 = errors, -1 = removed).
- Regression streaks increment the `Run` counter; a non-zero value signals consecutive regressions without recovery. Total regressions and improvements help editors weigh whether a block is trending in the right direction.
- Aggregated regression hotspots combine cluster data from every variant, annotate the responsible variant label, and sort by regression frequency, severity delta, and recency. This drives the "Regression hotspots" list in the workbench header.
