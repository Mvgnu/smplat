# Email Delivery Strategy

## Objectives
- Provide reliable transactional email delivery (auth verification, order updates, invoices) without forcing dependence on third-party SaaS.
- Maintain flexibility to swap in Resend or Cloudflare Mail once desired, with minimal code changes.
- Ensure GDPR-compliant logging and traceability for all outbound communications.

## Architecture Overview
- **Primary Transport (self-managed)**: SMTP relay backed by an open-source mail server (e.g., Postal, Mailu, or Mailcow). Deployed within managed infrastructure, exposing authenticated SMTP credentials to the platform.
  - Pros: Full control, EU data residency, extensibility for DKIM/SPF management.
  - Operational Considerations: Requires DNS configuration, IP warming, monitoring for deliverability.
- **Fallback / Optional SaaS**: Resend API integration available through adapter pattern (switchable via environment variable). Future expansion planned for Cloudflare Mail once GA.
- **Email Templates**: Stored in repository (MJML/React Email) with build step to render HTML/text. Template engine shared between frontend (Next.js) and backend (FastAPI) via `packages/shared`.
- **Tracking & Logging**: Persist email metadata into `notifications` table; correlate with orders/users. Support message replays and auditing.

## Implementation Plan
1. **Mailer Abstraction**
   - Build TypeScript mailer interface (`Mailer`) in `packages/shared` to standardize payloads. ✅
   - Provide SMTP implementation using `nodemailer`. ✅
   - Provide stub Resend adapter, activated when `RESEND_API_KEY` is set. ✅
2. **Auth Emails**
   - Auth.js verification emails routed through mailer abstraction with shared template. ✅
   - Later extend to password reset, MFA enrollment, and security alerts.
3. **Backend Notifications**
   - FastAPI service to use `aiosmtplib` (async SMTP) for order and finance notifications.
   - Store delivery attempts in `notifications` table with status codes.
4. **Template Pipeline**
   - Introduce React Email or Handlebars templates under `packages/shared/email-templates`. ✅ (initial auth template via utility functions)
   - Precompile HTML/text variants; support localization.
5. **Monitoring**
   - Configure DMARC, SPF, DKIM for domain.
   - Set up health checks for SMTP relay and notify on bounce spikes.

## Configuration
```env
# Shared
EMAIL_FROM=no-reply@smplat.test
SMTP_HOST=smtp.internal.smplat
SMTP_PORT=587
SMTP_USER=smplat_app
SMTP_PASSWORD=super-secret
SMTP_SECURE=false

# Optional Resend
RESEND_API_KEY=
```

## Roadmap
- Phase 0: Implement SMTP mailer & Auth.js integration (current work).
- Phase 1: Introduce templating system and order confirmation emails.
- Phase 2: Add analytics (open/click tracking when permissible) and reporting dashboard.
- Phase 3: Evaluate migration path to Cloudflare Mail API while retaining SMTP fallback.

## Risks & Mitigations
- **Deliverability**: Warm up IPs, monitor reputation, use feedback loops.
- **Compliance**: Retain minimal PII in logs; allow opt-out for marketing categories.
- **Operational Load**: Automate TLS certificate renewal (e.g., via Traefik + Let's Encrypt) for self-hosted mail server.
