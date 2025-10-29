# Loyalty helpers

Loyalty helpers coordinate storefront interactions with the loyalty API layer.
Modules here should remain framework-agnostic and expose typed functions for
server routes and actions to reuse. Avoid embedding UI or React logic in this
folder—keep it focused on data transport, validation, and shared constants.

`intents.ts` provides a lightweight persistence bridge that lets checkout stash
loyalty intent metadata in local storage so the success experience and loyalty
hub can rehydrate “next action” prompts without duplicating business rules.
