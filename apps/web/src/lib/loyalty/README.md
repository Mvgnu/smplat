# Loyalty helpers

Loyalty helpers coordinate storefront interactions with the loyalty API layer.
Modules here should remain framework-agnostic and expose typed functions for
server routes and actions to reuse. Avoid embedding UI or React logic in this
folder—keep it focused on data transport, validation, and shared constants.
