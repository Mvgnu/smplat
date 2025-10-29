# Checkout recovery orchestration

## Overview
- Checkout orchestration persists the multi-stage lifecycle for storefront orders and exposes the current stage via `/api/v1/checkout/orchestrations/:order_id`.
- Stages include payment confirmation, identity verification, loyalty holds, and fulfillment readiness. Each transition records an audit event for operators.
- The storefront success page now surfaces a recovery banner summarizing the active stage, most recent transition, and any pending loyalty steps still owned by the member.

## Key components
- **Models**: `CheckoutOrchestration` and `CheckoutOrchestrationEvent` store stage/state metadata. Alembic revision `20251201_31_checkout_orchestration` introduces the schema.
- **API**: The FastAPI router under `smplat_api.api.v1.endpoints.checkout` exposes read/write endpoints for orchestration state.
- **Scheduler**: Job `monitor_checkout_orchestrations` (scheduled every 30 minutes) acquires overdue orchestrations, sends recovery prompts, and advances `next_action_at` to avoid duplicate notifications.
- **Notifications**: `NotificationService.send_checkout_recovery_prompt` emails members with the current stage and resume link while respecting opt-out preferences.
- **Web**: `/checkout/success` pulls orchestration status via `/api/checkout/orchestrations/:orderId` and renders the `CheckoutRecoveryBanner` component.

## QA checklist
1. Trigger a checkout flow and ensure the success page renders the recovery banner with the correct stage copy.
2. Confirm `/api/v1/checkout/orchestrations/:id` returns the persisted stage and that posting an event advances to the next stage.
3. Seed a pending orchestration with `next_action_at` in the past, run `monitor_checkout_orchestrations`, and verify a new event with note "Recovery sweep executed" is recorded.
4. Validate notification preferences by toggling `order_updates` for a member and rerunning the job—emails should be skipped and logged when disabled.
5. In bypass mode (`NEXT_PUBLIC_E2E_AUTH_BYPASS=true`), ensure the success page renders a mocked orchestration without calling the API.

## Failure triage
- **API 404**: Indicates the order id was not found. Confirm the order exists and the orchestration row was created; the GET endpoint calls `get_or_create` to lazily seed if missing.
- **Job errors**: Re-run `monitor_checkout_orchestrations` with `LOG_LEVEL=DEBUG` to inspect fetch failures. Missing members increment the `escalations` counter and leave a metadata note.
- **Notification delivery**: `NotificationService.sent_events` (or logs) should include `checkout_recovery_prompt` events. If empty, verify SMTP configuration and that member emails are present.
- **Front-end fetch**: Inspect `/api/checkout/orchestrations/:orderId` responses. A 502 indicates the upstream API rejected the request—check `CHECKOUT_API_KEY` secrets and API health.

## References
- Backend models: `apps/api/src/smplat_api/models/checkout.py`
- Orchestrator service: `apps/api/src/smplat_api/services/checkout/orchestrator.py`
- Scheduler: `apps/api/src/smplat_api/jobs/checkout_recovery.py`
- Front-end banner: `apps/web/src/components/checkout/recovery-banner.tsx`
- Success page integration: `apps/web/src/app/(storefront)/checkout/success/page.tsx`
