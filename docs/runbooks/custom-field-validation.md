# Custom Field Validation Runbook

## Purpose
Merchandising operators use the custom-field builder inside `/admin/products` to collect brief requirements before orders enter fulfillment. The new FieldValidationPanel standardizes how we capture helper text, regex guidance, numeric steps, and sample values so data contracts stay aligned across admin, storefront, and FastAPI.

## Workflow
1. **Open the FieldValidationPanel** within a custom field card to configure:
   - Min/max length for text inputs.
   - Min/max/numeric step for number inputs (enforced client + server side).
   - Regex pattern, flags, description, and a sample tester (stores pass/fail for auditability).
   - Whitelisted allowed values (rendered as datalist suggestions + validation).
   - Sample values (one per line) shown to operators + storefront customers for guidance.
   - Passthrough toggles (checkout vs. fulfillment) still controlled via the main card.
2. **Visibility rules** continue to live beneath the panel; use them to gate fields based on options, add-ons, plans, or channels.
3. **Storefront experience:** The updated ProductConfigurator shows helper text, sample chips, and allowed-value hints. Validation errors are surfaced inline, and telemetry is emitted whenever runtime validation fails.
4. **Merchandising builder parity:** The `/admin/merchandising` OptionMatrixEditor now reuses the same panel so presets + draft configurations serialize identical metadata. Passthrough toggles (checkout vs. fulfillment) and default values live on the card header, making it obvious what information flows into storefront presets.

## Environment / Schema Touchpoints
- FastAPI contract: `ProductCustomFieldMetadata` accepts the richer JSON (regex testers, sampleValues, numericStep, allowedValues).
- Next.js server actions serialize metadata via `serializeCustomFieldMetadata` and rehydrate with `sharedNormalizeCustomFieldMetadata`.
- DB storage: `product_custom_fields.metadata_json` (JSONB) stores the merged metadata. No additional migrations required.

## Verification
- Unit: `pnpm --filter @smplat/web test:unit -- FieldValidationPanel product-configurator-validation.test.tsx`
- API: `poetry run pytest tests/test_product_service_integration.py::test_custom_field_metadata_round_trip`
- Manual smoke: create a product with `allowedValues`, numeric step, and regex tester; load the storefront detail page and ensure inputs display hints + block invalid data.

## Troubleshooting
| Symptom | Action |
| --- | --- |
| Regex tester always fails | Confirm flags are valid (e.g., `g` is unsupported in Safari's lookbehind). The tester uses browser `RegExp`; check console for syntax errors. |
| Allowed values ignored in storefront | Ensure `FieldValidationPanel`'s textarea uses newline or comma separators without extra quotes; the builder trims whitespace before serialization. |
| Numeric step not enforced | Verify the field type is set to `number`; steps do not apply to text/email inputs. Also confirm the value is >0 before saving. |
| Metadata missing in API response | Check FastAPI logs for validation errors — `ProductCustomFieldMetadata` rejects unknown keys. Run the pytest above to ensure schema drift wasn't introduced. |

## References
- Admin UI implementation: `apps/web/src/components/admin/fields/FieldValidationPanel.tsx`
- Serialization helpers: `apps/web/src/lib/product-metadata.ts`
- Storefront runtime: `apps/web/src/components/products/product-configurator.tsx`
