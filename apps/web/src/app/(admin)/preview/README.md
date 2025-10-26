# Admin Marketing Preview Cockpit

This route renders the interactive marketing preview cockpit for Payload-backed content editors. It runs on the admin surface at `/admin/preview` and is responsible for:

- Fetching deterministic marketing snapshots for both published and draft states using the shared CMS preview utilities.
- Hydrating the client-side cockpit that surfaces diff visualizations and fallback guidance.
- Serving as the entry point for future live preview streaming and personalization controls.

The page is implemented as a server component to ensure preview snapshots are collected on the server. Client interactivity lives inside `PreviewWorkbench` under `@/components/marketing/preview`.
