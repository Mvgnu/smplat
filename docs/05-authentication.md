# Authentication & Authorization Blueprint

## Identity Stack
- **Framework**: Auth.js (NextAuth) self-hosted within Next.js App Router.
- **Session Storage**: REST adapter backed by FastAPI identity endpoints; secure cookies with `SameSite=Lax`, `HttpOnly`, `Secure`.
- **Token Format**: JWT for stateless APIs; short-lived access tokens (15 min) + refresh tokens (rolling 30 days) stored encrypted in Postgres.
- **Password Hashing**: Argon2id with adaptive parameters; enforce minimum complexity and breach checking (HaveIBeenPwned API optional).

## User Journeys
- **Sign-up**
  - Email verification required (magic link) before activating account.
  - Optional OAuth providers: Google, LinkedIn (for business credibility), Facebook, Instagram (for quick binding).
  - Capture initial profile info (name, organization, Instagram handle) post-verification wizard.
- **Login**
  - Supports email/password, OAuth, magic link.
  - Risk-based prompts for MFA if unfamiliar device/IP.
- **Password Reset**
  - Time-bound reset tokens (15 min) delivered via email; single-use enforced.
  - Post-reset, invalidate existing sessions.
- **Multi-Factor Authentication**
  - TOTP (RFC 6238) via authenticator apps.
  - Backup recovery codes stored hashed; optional WebAuthn support backlog.
- **Role Onboarding**
  - Default role `client`; admin/finance roles assigned manually via admin portal with audit logging.

## Email Transport
- Verification emails delivered through internal SMTP relay (fallback to Resend adapter).
- Templates rendered via shared React Email components with localization support.
- Delivery status recorded in backend `notifications` table for auditability.

## Security Controls
- Rate limiting on auth endpoints via middleware (e.g., Upstash Redis or self-managed Redis).
- Device & session management UI for clients (view/revoke sessions).
- Suspicious activity detection (geo-IP anomalies) triggering alerts and forced MFA.
- Regular session rotation (every 24h) and forced re-auth after privileged actions.
- CSRF protection through Auth.js anti-CSRF tokens and Next.js server actions.
- Content Security Policy tuned for auth routes; HTTP security headers via middleware.

## Backend Integration
- FastAPI validates JWTs via shared signing keys; uses OAuth2 Password & Bearer flows where necessary.
- Role & permission claims embedded in tokens; backend enforces RBAC per endpoint.
- Service-to-service calls use client credentials flow with short-lived PATs stored in Vault.

## Data Privacy
- Explicit consent flows for storing Instagram handles and marketing preferences.
- Support GDPR requests through portal (data export/delete) tying into `GDPRRequest` entity.
- Logging minimized on PII; sensitive fields encrypted at rest (e.g., using pgcrypto or application-layer encryption).

## Implementation Tasks
1. Configure Auth.js with the REST adapter, Argon2, and session encryption keys.
2. Implement sign-up and verification flows with transactional emails.
3. Build MFA enrollment and enforcement screens within client portal.
4. Create admin UI for role management and audit trail of changes.
5. Expose session management API for FastAPI to revoke/validate tokens.
6. Write automated tests (Playwright + Jest) covering login, MFA, password reset paths.
