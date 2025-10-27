# Marketing Preview Components

This folder contains interactive components that power the marketing preview cockpit within the admin surface.

- `PreviewWorkbench.tsx` – timeline-aware workspace for navigating routes, comparing draft/published snapshots, triaging regressions, and documenting notes. The workbench now hydrates its history stream through the live `/api/marketing-preview/history` endpoint rather than local fixtures.

Components in this directory assume marketing preview snapshots are collected through `@/server/cms/preview`. Keep metadata comments (`key: value`) up to date so automation can track features.

## Timeline & triage workflow

`PreviewWorkbench` receives the latest capture from `collectMarketingPreviewSnapshotTimeline` for instant hydration, then streams persisted history through the `useMarketingPreviewHistory` hook. The hook issues typed queries against `/api/marketing-preview/history`, caches responses with React Query, and mirrors the latest successful payload in `localStorage` (`marketing-preview-history-cache-v3`) so the cockpit keeps working offline. Editors can scrub through captures via the left sidebar timeline, review per-route diff badges, and open regression notes for the active route. Notes are persisted through the `/api/marketing-preview/notes` endpoint and stored locally for development under `apps/web/src/server/cms/__fixtures__/marketing-preview-notes.json`.

- Use the severity selector to categorize issues (`info`, `warning`, or `blocker`).
- Notes are grouped by `generatedAt` + route and surface counts directly in the route navigation to guide triage.
- Timeline history is sourced from the durable SQLite-backed history service at `apps/web/.data/marketing-preview-history.sqlite`; running the snapshot writer appends new entries automatically. The history store now captures live preview deltas, fallback remediation attempts, and triage note revisions alongside manifests (deduped by SHA-256 hashes) so retrospectives include intra-capture context. Route, severity, and variant filters issue server-side queries, and pagination buttons page through persisted manifests without losing cache state. When offline, the hook replays the most recent cached payload—including the delta/remediation/note ledgers and analytics forecast—until connectivity returns.
- The predictive diagnostics panel at the top of the workbench reads `analytics` from the history response to surface regression velocity, severity momentum, time-to-green forecasts, and remediation suggestions. Sparkline visualisations show trendlines over the retained manifests, while operators can log hashed feedback locally for post-mortem follow-up.

## Live streaming & validation loop

- `useLivePreview.ts` opens an SSE connection to `/api/marketing-preview/stream` and merges incoming payloads into the current timeline entry. When offline, the hook gracefully falls back to the last persisted snapshot. Every broadcast is now persisted to the history store for replay and analytics.
- The SSE handler verifies `PAYLOAD_LIVE_PREVIEW_SECRET`, normalizes Lexical content, renders markup with `MarketingSections`, and validates each block via `validateMarketingBlock`.
- Live activity appears in the workbench header, per-route badges, and the validation feed. Editors can clear the feed after triage for a clean slate.
- Diagnostics are persisted per route through the live stream. `useLivePreview` maintains a rolling ledger per variant that compares the latest diagnostics with the previous snapshot so regressions are obvious. Each ledger entry captures block-level diff metadata (added, removed, regressed, improved) and maintains a fingerprint buffer so recurring issues surface immediately.
- `BlockDiagnosticsPanel.tsx` renders the ledger summary, diff clusters, section-level warnings, and detailed block traces. Diff clusters retain a rolling history of block fingerprints, trace hashes, and severity changes so regression streaks are visible at a glance. Editors can copy Payload paths, inspect fallback provenance, or reprioritize fallbacks from the cockpit without leaving the workbench. Structured recovery hints now map into remediation playbooks that outline Payload deep links and fixture provenance for guided triage.
- Variant selectors in the workbench allow switching between baseline and audience variants. Drift metrics and "since last green" summaries highlight whether a variant has recovered. Regression hotspots are aggregated across variants to flag the riskiest blocks.
- `/api/marketing-preview/fallbacks` accepts authenticated `reset` and `prioritize` actions, updating in-memory counters for governance monitoring while respecting the privacy requirement (no personal telemetry is stored). Each acknowledged action is recorded in the history store so cockpit drilldowns can compare simulated vs. live outcomes.

## Diff overlays & cluster semantics

- Ledger entries now feed a diff-cluster engine that records the latest status (`added`, `removed`, `regressed`, `improved`, `steady`) alongside a severity sparkline per block. The heatmap in the diagnostics panel depicts the eight most recent severity points (0 = clean, 1 = warnings, 2 = errors, -1 = removed).
- Regression streaks increment the `Run` counter; a non-zero value signals consecutive regressions without recovery. Total regressions and improvements help editors weigh whether a block is trending in the right direction.
- Aggregated regression hotspots combine cluster data from every variant, annotate the responsible variant label, and sort by regression frequency, severity delta, and recency. This drives the "Regression hotspots" list in the workbench header.
