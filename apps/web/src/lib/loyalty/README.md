# Loyalty helpers

Loyalty helpers coordinate storefront interactions with the loyalty API layer.
Modules here should remain framework-agnostic and expose typed functions for
server routes and actions to reuse. Avoid embedding UI or React logic in this
folder—keep it focused on data transport, validation, and shared constants.

`intents.ts` now mirrors the server-driven checkout intent feed. Storefront
surfaces seed local storage from API responses so offline flows stay resilient,
but server IDs, statuses, and expiration metadata remain the source of truth.
Helpers expose `persistServerFeed` to merge `/loyalty/next-actions` payloads,
`queueCheckoutIntents` for optimistic drafts, and consumer helpers to read or
clear cached entries when members dismiss actions across surfaces.
