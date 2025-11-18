# Compliance & Bookkeeping Plan

## Regulatory Context
- Operate under German commercial and tax regulations (GoBD, VAT compliance, DSGVO/GDPR).
- Manage digital service sales across EU with OSS (One Stop Shop) VAT considerations.
- Maintain financial records for 10 years; ensure auditability and tamper-evident storage.

## Bookkeeping Workflow
1. **Order Completion**
   - Stripe captures payment → FastAPI creates invoice data → generate PDF with sequential invoice number (date-based prefix + counter).
2. **Invoice Handling**
   - PDF stored in S3 with WORM policy; metadata stored in `invoices` table.
   - Email invoice to client and finance team; include VAT breakdown.
3. **Receipt Artifacts**
   - FastAPI triggers the storefront PDF renderer to hydrate the order receipt payload (same blueprint data surfaced in `/checkout/success` + `/account/orders`).
   - The resulting PDF is attached directly to the payment-success notification so finance + customers receive the exact compliance snapshot.
   - `ReceiptAttachmentService` uploads the PDF to the configured object storage bucket (`RECEIPT_STORAGE_BUCKET` + `RECEIPT_STORAGE_PREFIX`) and records the storage key/URL/timestamp on the `orders` table.
   - Storefront downloads (`/account/orders`, `/checkout/success`) now prefer the stored artifact URL when present, guaranteeing parity between emails, PDFs, JSON exports, and audit storage.
3. **Lexoffice Sync**
   - OAuth2 service account; backend schedules sync job.
   - Create customer/contact if missing, push invoice, attach payment data.
   - Store sync status and response payload in `lexoffice_sync_logs`.
4. **Reconciliation**
   - Daily job fetches payment updates from Lexoffice to ensure status alignment.
   - Finance dashboard surfaces discrepancies, supports manual retry.

## Compliance Controls
- **Audit Trail**: Every finance-affecting action logged in `audit_log`; include actor, before/after, timestamp, correlation ID.
- **Data Retention**: Implement retention policies per entity; invoices retained indefinitely, support data 3 years, personal data per consent.
- **GDPR Rights**: Expose tooling for data export and deletion requests; cascade deletions while preserving financial records (pseudonymize personal fields).
- **Access Control**: Finance views restricted to `finance` role; 4-eye approval for refunds/credit notes.
- **Security**: Encrypt sensitive fields (VAT ID, banking details). Enforce TLS, limited network access to Lexoffice endpoints.
- **Attachment Monitoring**: `/api/v1/health/readyz` now reports a `receipt_storage` component that verifies the S3 bucket/public URL configuration **and** reads the latest sentinel probe telemetry (last success/error timestamps, detail strings). The new `receipt_storage_probe_worker` (or `tooling/scripts/run_receipt_storage_probe.py`) writes/reads/deletes a zero-byte PDF to confirm credentials, ACL, and retention.

## Monitoring & Reporting
- Scheduled reports: monthly revenue, tax liability, outstanding invoices, Lexoffice sync failures.
- Alerts via PagerDuty/Slack for webhook failures, reconciliation mismatches, invoice generation errors.
- Dashboard metrics aggregated via warehouse (future extension) or direct SQL views.

### Receipt Storage Probe Runbook
1. **Daily automation** – keep `receipt_storage_probe_worker` enabled in FastAPI (or schedule `tooling/scripts/run_receipt_storage_probe.py --fail-on-error` via cron/Celery). The worker emits log lines and updates the telemetry row so `/readyz` callers see freshness.
2. **Verification steps**
   - Hit `/api/v1/health/readyz` and confirm `receipt_storage` status `ready` with `last_success_at` within the last 24 h; `detail` should mention the sentinel key.
   - If `status` is `error` or `degraded`, inspect application logs for `Receipt storage probe` entries and check S3 audit logs for access denials/lifecycle deletions.
   - Re-run the probe manually via `tooling/scripts/run_receipt_storage_probe.py --fail-on-error` to capture metrics in the incident ticket.
3. **Remediation**
   - Verify credentials/ACLs on the bucket (especially if the probe failed on `get_object`).
   - Confirm lifecycle/retention policies did not purge the sentinel prefix prematurely; adjust `RECEIPT_STORAGE_PREFIX` or retention window if needed.
   - After fixes, re-run the script and ensure `/readyz` updates the telemetry timestamps before closing the incident.

### Automation Toggle & Observability
- Enable the worker in prod/staging by setting `RECEIPT_STORAGE_PROBE_WORKER_ENABLED=true` alongside the cadence controls `RECEIPT_STORAGE_PROBE_INTERVAL_SECONDS` (default 24h) and freshness guardrail `RECEIPT_STORAGE_PROBE_MAX_STALE_HOURS`.
- Each worker tick now emits structured logs with `worker=receipt_storage_probe`, `success`, `detail`, and `sentinel_key` fields—ship these to the metrics pipeline (e.g., log-based SLO for success ratio or alert on stale intervals).
- When running via cron or CI, invoke `tooling/scripts/run_receipt_storage_probe.py --fail-on-error` so automation inherits the same telemetry+logging surface as the in-process worker.

## Implementation Tasks
1. Document invoice numbering scheme and configure in backend service.
2. Select PDF generation library (WeasyPrint, ReportLab) and design invoice template.
3. Implement Lexoffice client module with retries, exponential backoff, observability.
4. Build finance dashboard components in admin portal.
5. Define data retention policies and implement cron jobs for cleanup/anonymization.
6. Conduct compliance review with external accountant before go-live.
