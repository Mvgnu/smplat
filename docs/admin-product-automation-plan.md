# Admin Product Automation Plan

## Scope
Overhaul the admin product tooling so campaign creation maps cleanly to storefront UX and downstream fulfillment without relying on ambiguous “variation” metadata.

## Milestones
1. **Field Rule Engine** — ✅ Completed
   - Configurable validation (required, regex/no whitespace, min/max length).
   - Flags to include field values in checkout payloads and fulfillment dispatch.
   - 2025-11 update: Introduced the composable `FieldValidationPanel` so operators can author regex snippets (with testers), numeric steps, allowed value whitelists, and sample value guidance. The storefront configurator now enforces allowed values + numeric increments, renders chip-style hints, and surfaces regex feedback. Verification: `pnpm --filter @smplat/web test:unit -- FieldValidationPanel product-configurator-validation.test.tsx`, `poetry run pytest tests/test_product_service_integration.py::test_custom_field_metadata_round_trip`.
   - Verification: `pnpm --filter @smplat/web lint`
2. **Structured Variations** — ✅ Completed
   - Define per-option payload with `amount`, `unitPrice`, `basePrice`, `dripMinPerDay`, and tiered discounts.
   - Storefront builder renders tiered pricing + “buy X more” prompts.
   - Progress (current iteration):
     - Admin matrix builder now captures `structuredPricing` (amount/unit, base + unit price, drip floor, discount tiers) and `media` attachments per variation.
     - Storefront + cart pipeline read `structuredPricing` to display tier summaries alongside legacy `priceDelta`.
     - Example payload:
       ```json
       {
         "amount": 1000,
         "amountUnit": "followers",
         "basePrice": 799,
         "unitPrice": 0.799,
         "dripMinPerDay": 150,
         "discountTiers": [
           { "minAmount": 2000, "unitPrice": 0.75, "label": "Scale 2k" },
           { "minAmount": 5000, "unitPrice": 0.7, "label": "Dominance 5k" }
         ]
       }
       ```
     - `option.metadataJson.media` links uploader assets to variation ids:
       ```json
       [
         { "assetId": "uuid-hero", "usage": "hero", "label": "Hero render" },
         { "assetId": "uuid-gallery-1", "usage": "gallery", "label": "Mockup" }
       ]
       ```
   - Backfill migration `20251210_36_product_option_structured_pricing` syncs legacy rows and storefront/cart pricing now prefers `structuredPricing.basePrice` while retaining `priceDelta` fallback.
   - Verification: `pnpm --filter @smplat/web lint`, `pnpm --filter @smplat/web test:unit -- product-configurator.test.tsx`
3. **Advanced Add-ons**
   - Support flat fee, percentage multiplier, and direct service overrides (e.g. `serviceId=321`).
   - Update price preview + checkout math to reflect chosen add-ons.
   - In-flight scope:
     - Persisted fulfillment provider catalog replaces the in-memory registry. Admins can manage providers/services (status, health, credentials) via `/admin/fulfillment/providers`; FastAPI CRUD endpoints power automation.
     - Introduce `addOn.metadataJson.pricing` with `{ mode: "flat" | "percentage" | "serviceOverride", amount, serviceId, notes }`.
     - Surface pricing model selection in admin UI and ensure storefront/cart computation + API snapshots honour multiplier/override semantics.
   - **NEW**: Service override controls now pull directly from the provider catalog. Admins can bind an add-on to a provider + service, specify provider cost, fulfillment mode (immediate/scheduled/refill), drip targets, and a payload template that becomes part of the downstream provider order.
4. **Variation Media**
   - Attach uploaded assets to specific options and surface them in the storefront.
5. **Cleanup & UX Polish**
   - Remove legacy calculator/image URL fields and tidy admin copy.
   - Align documentation and preview panels with the new data model.
6. **Fulfillment Mapping**
   - UI to configure API call templates (endpoint, params) and rule-based overrides driven by option/add-on selections and field values.
   - Persist mappings for the fulfillment worker (order creation, status, refill, cancel).

## Execution Notes
- Each milestone ships behind the existing admin form, with progressive data migrations to keep compatibility.
- Update this document after each milestone: mark completion, add verification (lint/tests/manual), and note follow-up actions.
- Coordinate with fulfillment services to validate payload contracts once the mapping UI lands.
