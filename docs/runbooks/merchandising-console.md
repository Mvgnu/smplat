# Merchandising Console Runbook

## Purpose
- key: module: admin-merchandising
- key: owner: operator-experience

The merchandising console allows operators to manage catalog products, channel eligibility, pricing posture, and bundle curation without leaving the admin workspace. It coordinates with the FastAPI backend for audit logging and rollback.

## Product workflow
1. Review KPI tiles on `/admin/merchandising` for live/draft coverage and channel mix.
2. Adjust channel eligibility and publishing status via the per-product controls. Each submission triggers the FastAPI `ProductService` and records an immutable audit log.
3. Upload supporting assets using the gallery manager. Files stream through `/api/merchandising/products/upload-url` into the `ASSET_BUCKET` (`ASSET_UPLOAD_PREFIX`), and the API records `storage_key` + `checksum` on `product_media_assets`.
4. Use the audit log restore button to roll back an accidental change. This posts to `/api/v1/products/audit/{id}/restore` and revalidates the page.

## Bundles workflow
1. Inspect existing bundles in the right rail. Each card lists component product slugs and the configured CMS priority.
2. Create or edit bundles via the form. Enter one product slug per line to define component membership.
3. Use the delete control to remove deprecated bundles. Rest calls `CatalogBundleService.delete_bundle` and refreshes the console.

## Staging to production promotion
1. Capture catalog snapshots in staging by exporting `/api/v1/products` and `/api/v1/catalog/bundles` payloads.
2. Apply updates in staging first; verify audit logs reflect the intended changes.
3. Promote by replaying the same mutations in production or seeding via database migration using the recorded snapshots.
4. Confirm asset uploads land in the configured object storage prefix (check `ASSET_BUCKET`), not the legacy `public/uploads/` path.

## QA checklist
- Verify the merchandising page renders product rows with accurate price and channel metadata.
- Toggle each product's status and ensure audit entries append with correct timestamps.
- Upload a sample asset (<=1MB) and confirm it appears in the `ASSET_BUCKET/ASSET_UPLOAD_PREFIX` prefix and the API response.
- Create, update, and delete a bundle; ensure API endpoints respond with 201/200/204 respectively.
- Execute an audit restore and check that the product reverts to the previous state.

## Troubleshooting
- key: escalation: #ops-merchandising
- key: observability: catalog-merchandising-dashboard

1. **Failed uploads** – ensure the web tier has credentials for `ASSET_BUCKET` and can mint signed URLs. Check logs for `Signed uploads are not configured` errors.
2. **Audit restore failures** – verify the audit entry still references a product. Entries older than the product lifetime may have `product_id = null` and cannot be restored.
3. **Bundle API errors** – confirm the FastAPI service is running with revision `20251124_28` migrated; missing tables trigger 500s.
