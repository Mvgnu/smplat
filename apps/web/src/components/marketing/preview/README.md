# Marketing Preview Components

This folder contains interactive components that power the marketing preview cockpit within the admin surface.

- `PreviewWorkbench.tsx` – client-side workspace for navigating routes, comparing draft/published snapshots, and viewing markup diffs.

Components in this directory assume marketing preview snapshots are collected through `@/server/cms/preview`. Keep metadata comments (`key: value`) up to date so automation can track features.
