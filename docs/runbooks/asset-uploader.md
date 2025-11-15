# Asset Uploader Runbook

## Purpose
Operators and merchandising admins now upload structured media through the admin console. Files are streamed directly to object storage (S3-compatible) using short-lived signed URLs so we no longer rely on the `public/uploads` temp directory. This runbook covers environment setup, operational checks, and remediation steps.

## Environment & Secrets

| Variable | Description |
| --- | --- |
| `ASSET_BUCKET` | Target S3 bucket for product media. Required for signed uploads. |
| `ASSET_REGION` | AWS/S3 region, e.g., `us-east-1`. |
| `ASSET_PUBLIC_BASE_URL` | Public base URL that maps to the bucket (e.g., `https://cdn.example.com` or the bucket website URL). |
| `ASSET_UPLOAD_PREFIX` | Optional key prefix; defaults to `product-media`. |
| `ASSET_S3_ENDPOINT` | Optional custom endpoint (MinIO, Cloudflare R2, etc.). |
| `ASSET_S3_FORCE_PATH_STYLE` | Set to `true` when the endpoint requires path-style addressing. |
| `ASSET_UPLOAD_EXPIRY_SECONDS` | Optional override for upload URL TTL (default 300 seconds). |
| `ASSET_CLEANUP_PREFIX` | Prefix scanned by the cleanup job (defaults to `${ASSET_UPLOAD_PREFIX}/tmp/`). |
| `ASSET_CLEANUP_MAX_AGE_MINUTES` | Minutes before a temp object is considered stale (default 60). |

> **Tip:** For local development without S3 credentials, omit `ASSET_BUCKET` and the server will fall back to the legacy `apps/web/public/uploads` path. QA/Staging/Prod **must** provide the S3 settings.

## Upload Flow
1. Admin UI queues assets in `AssetGalleryManager`, capturing `clientId`, `displayOrder`, `usageTags`, etc.
2. When the queue is submitted, the server action calls `createSignedProductUpload`, which mints a PUT URL via `/api/merchandising/products/upload-url`.
3. Each file is hashed (SHA-256) before upload; the checksum and storage key are forwarded to FastAPI via `ProductService.attach_media_asset`.
4. The API persists metadata (`client_id`, `usage_tags`, `display_order`, `is_primary`, `alt_text`, `storage_key`, `checksum`) so previews and storefront renders have the enriched gallery.

## Operational Checks
- `poetry run alembic upgrade head` should succeed (enum migrations are now idempotent).
- `poetry run pytest tests/test_product_service_integration.py` covers the media attachment round-trip.
- `pnpm --filter @smplat/web lint && pnpm --filter @smplat/web test:unit` before promoting UI changes.

## Cleanup Job
Unsigned uploads that never attach to a product accumulate under the `tmp` prefix. Run the cleanup script (weekly cron in staging/prod):

```bash
ASSET_BUCKET=smplat-assets \
ASSET_REGION=us-east-1 \
ASSET_UPLOAD_PREFIX=product-media/tmp \
pnpm --filter @smplat/web exec node ../../tooling/scripts/asset-upload-cleanup.mjs
```

The job lists `ASSET_CLEANUP_PREFIX` and deletes objects older than `ASSET_CLEANUP_MAX_AGE_MINUTES` (default 60). Log output records the number of deleted objects per batch.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `Signed uploads are not configured` error | Verify `ASSET_BUCKET` and `ASSET_PUBLIC_BASE_URL` are set for the web tier process. |
| `Failed to upload asset to object storage` in server logs | Check IAM permissions for `s3:PutObject` on `ASSET_BUCKET` and confirm the endpoint is reachable from the Next.js worker. |
| Images not visible in admin preview | Confirm the asset URL is publicly resolvable (or proxy through CDN) and that `usageTags` were included in the draft manifest. |
| Cleanup job deletes nothing | Ensure `ASSET_CLEANUP_PREFIX` matches the prefix used for temporary uploads. Run with `DEBUG=1` to inspect listed keys. |

## References
- FastAPI schema: `apps/api/src/smplat_api/schemas/product.py`
- Alembic migration: `apps/api/alembic/versions/20251215_42_product_media_asset_enrichment.py`
- Next.js storage helper: `apps/web/src/server/storage/uploads.ts`
- Cleanup script: `tooling/scripts/asset-upload-cleanup.mjs`
