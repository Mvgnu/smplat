# Observability Utilities

This directory centralises logging and metric helpers used by the marketing site when interacting with CMS providers.

- `logger.ts` writes structured JSON logs for preview/revalidation routes so downstream collectors can ingest provider metadata.
- `cms-telemetry.ts` keeps in-memory counters for preview/revalidation outcomes that can be scraped by optional monitoring hooks.
- `catalog-insights.ts` fetches third-party analytics and is unaffected by the CMS flows.

Keep helpers side-effect free beyond logging/metric emission so they remain safe to import within Next.js route handlers.
