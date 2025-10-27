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
- Per-block panels surface inline errors and warnings so marketing teams can adjust Payload documents without waiting for the next static snapshot.
