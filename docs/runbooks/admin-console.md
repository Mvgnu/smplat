# Admin Console Handbook

- key: module: admin-console
- key: owner: operator-experience
- key: last_reviewed: 2025-02-15

## Overview
The admin workspace centralizes operator tooling for orders, loyalty, onboarding, and merchandising. Access requires an authenticated session with the `FINANCE` (operator) or `ADMIN` role; layout gating is enforced through `requireRole` in `apps/web/src/server/auth/policies.ts` and middleware-level RBAC.

## Access Controls & Session Expectations
1. Visit `/login` and authenticate via the configured identity provider.
2. Operators are routed to `/admin/orders` after login. Admins see the same surface but retain elevated privileges (e.g., guardrail overrides, merchandising rollbacks).
3. Sessions inherit permission snapshots from NextAuth callbacks. If permissions appear stale, terminate the browser session and re-authenticate so the callback can refresh role metadata.
4. Incident or audit investigations should cross-reference the [security runbook](./security.md) for promotion and emergency bypass procedures.

## Layout Orientation
- Sidebar navigation lists Orders, Merchandising, Loyalty, Onboarding, and Operations dashboards. The header houses the global search stub and notification placeholder.
- Breadcrumbs (`AdminBreadcrumbs`) surface context-specific paths, while `AdminTabNav` exposes cross-module tabs for rapid switching.
- KPI cards, data tables, and filter pills are implemented in `apps/web/src/components/admin`. Extend design tokens in that directory when creating new modules.

## Orders Workspace
- **Purpose:** Monitor every checkout intent and track fulfillment progress across payment, verification, and loyalty hold states.
- **Primary actions:**
  - Filter orders by lifecycle state and drill into a selected record to review milestone progress pulled from `fetchOrderProgress`.
  - Adjust order status through the `OrderStatusForm`, which posts to protected server actions with CSRF validation.
  - Launch checkout recovery nudges using contextual links to the loyalty runbook when orders stall.
- **Operational tips:** Review the recovery monitor output in `/admin/orders` before triggering manual escalations. Confirm mutations succeed by checking optimistic toasts and the structured log stream (`server_action_success`).

## Merchandising Console
- **Purpose:** Curate product catalog items, channel eligibility, bundle compositions, and asset uploads without leaving the admin shell.
- **Primary actions:**
  - Update per-product availability and pricing tiers; each submission calls the FastAPI catalog service and records audit events.
  - Upload supporting media via the local upload bridge (stored under `apps/web/public/uploads/`).
  - Restore prior states through the audit log rollback controls.
- **References:** See [`merchandising-console.md`](./merchandising-console.md) for staging promotion steps and QA checklists.

## Loyalty Guardrail Console
- **Purpose:** Observe invite quotas, cooldown timers, throttle states, and manage override justifications.
- **Primary actions:**
  - Inspect KPIs for active overrides, members at quota, and cooldown windows.
  - Submit override forms that call FastAPI endpoints with justification text and audit trails.
  - Clear overrides when automation can resume control.
- **References:** Detailed API behavior lives in [`loyalty-guardrails.md`](./loyalty-guardrails.md).

## Onboarding Operations
- **Purpose:** Coordinate manual onboarding tasks and nudges surfaced from the FastAPI onboarding service.
- **Primary actions:**
  - Review outstanding onboarding workflows from the operations tab.
  - Trigger manual nudges or acknowledgements through server actions guarded by `ensureCsrfToken`.
  - Mirror customer-facing progress with the storefront timeline for parity checks.
- **References:** Follow [`onboarding-console.md`](./onboarding-console.md) for escalation paths and SLA targets.

## Observability & Support
- Subscribe to structured logs filtered by `service=web-admin` to capture server action results, policy denials, and network anomalies.
- Monitor `/api/v1/health/readyz` and loyalty job dashboards when diagnosing stale admin data.
- File incidents or enhancements in the operator backlog, referencing this handbook to capture reproduction steps and expected behaviors.
