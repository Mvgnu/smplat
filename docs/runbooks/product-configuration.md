# Product Configuration Runbook

## Overview
The merchandising API now supports transactional updates for product configuration artifacts (option groups, add-ons, custom fields, and subscription plans). Use these workflows when enabling dynamic product setup or debugging operator-facing builders.

## Endpoints
- `PUT /api/v1/products/{productId}/options`: replaces the full configuration payload for a product. The request must include any option groups, add-ons, custom fields, and subscription plans that should persist after the call. Omitted collections are cleared.
- Product creation and updates also accept the `configuration` payload, allowing nested relationships to be provisioned during the initial `POST /api/v1/products` call or a later `PATCH`.

## Payload Reference
```jsonc
{
  "optionGroups": [
    {
      "id": "optional-existing-group-id",
      "name": "Platform",
      "groupType": "single", // or "multiple"
      "isRequired": true,
      "displayOrder": 0,
      "metadata": { "audience": "creators" },
      "options": [
        {
          "id": "optional-existing-option-id",
          "name": "Instagram",
          "description": "Organic channel",
          "priceDelta": 0.0,
          "displayOrder": 0,
          "metadata": { "tier": "standard" }
        }
      ]
    }
  ],
  "addOns": [
    {
      "id": "optional-existing-addon-id",
      "label": "Priority Support",
      "description": "White-glove onboarding",
      "priceDelta": 99.0,
      "isRecommended": true,
      "displayOrder": 0
    }
  ],
  "customFields": [
    {
      "id": "optional-existing-field-id",
      "label": "Brand Hex",
      "fieldType": "text",
      "isRequired": true,
      "displayOrder": 0,
      "helpText": "Provide the primary color"
    }
  ],
  "subscriptionPlans": [
    {
      "id": "optional-existing-plan-id",
      "label": "Quarterly",
      "billingCycle": "quarterly",
      "priceMultiplier": 1.4,
      "priceDelta": 0.0,
      "isDefault": true,
      "displayOrder": 0
    }
  ]
}
```

## Validation
- Price deltas must fall between `-100000` and `100000` (inclusive). Values are persisted as decimals with two-digit precision.
- Subscription plan billing cycles accept `one_time`, `monthly`, `quarterly`, or `annual`. Any other value is rejected.
- Display orders default to index order when omitted; provide explicit integers to control ordering.
- Metadata objects are persisted verbatim—ensure they contain JSON-serialisable primitives only.

## Operational Notes
- Configuration writes run inside a single transaction. If any nested record fails validation, the entire update rolls back.
- Successful writes emit a `configuration_updated` entry in the product audit log summarising relationship counts.
- Use `GET /api/v1/products/{slug}` to validate the hydrated configuration returned to storefront or merchandising clients.
- Operators can compose configurations via the Admin Option Matrix builder (`apps/web/src/app/(admin)/merchandising/option-matrix-editor.tsx`).
  The UI maintains optimistic state, previews totals with `ProductConfigurator`, and posts JSON payloads through the
  `updateProductConfigurationAction` server action—use this flow for manual remediation or to verify payload shape before
  automating imports.
- Storefront product detail pages hydrate live configuration data through `fetchProductDetail`, exposing option groups,
  add-ons, plans, and custom fields for shoppers to price out scenarios before checkout. Verify storefront responses after
  updating configuration to ensure channel eligibility includes `storefront` and the product is active.

## Troubleshooting
- **400 errors on update**: confirm IDs map to existing records and billing cycles match the allowed enum values.
- **Missing options after update**: the replace semantics clear unmentioned collections. Re-send full sets from the UI builder.
- **Decimal precision issues**: always send numeric payloads as standard JSON numbers (not strings) to avoid extra parsing noise.
