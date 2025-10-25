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

## Monitoring & Reporting
- Scheduled reports: monthly revenue, tax liability, outstanding invoices, Lexoffice sync failures.
- Alerts via PagerDuty/Slack for webhook failures, reconciliation mismatches, invoice generation errors.
- Dashboard metrics aggregated via warehouse (future extension) or direct SQL views.

## Implementation Tasks
1. Document invoice numbering scheme and configure in backend service.
2. Select PDF generation library (WeasyPrint, ReportLab) and design invoice template.
3. Implement Lexoffice client module with retries, exponential backoff, observability.
4. Build finance dashboard components in admin portal.
5. Define data retention policies and implement cron jobs for cleanup/anonymization.
6. Conduct compliance review with external accountant before go-live.

