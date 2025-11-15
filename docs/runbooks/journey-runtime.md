# Journey Runtime Runbook

## Overview
Journey components let merchandising teams insert scripted steps into checkout, presets, and automation flows. With the new runtime plumbing you can now:

- Register reusable component definitions via `/api/v1/journey-components`.
- Attach ordered components (bindings, channels, metadata) inside `/admin/products`.
- Enqueue executions through `/api/v1/journey-components/run`.
- Inspect recent runs and product assignments with `/api/v1/products/{productId}/journeys`.

## Registering Components
1. Call `POST /api/v1/journey-components` with a unique `key`, triggers, script metadata, input schema, and optional provider dependencies.
2. Confirm the component appears in the registry via `GET /api/v1/journey-components`.

## Attaching Components to Products
1. Operators visit `/admin/products`, load or create an SKU, and use the “Journey components” panel to:
   - Pick a definition.
   - Define display order and channel eligibility (chips or autocompleted entries).
   - Configure bindings:
     - `static` for literal values.
     - `product_field` to map product JSON paths.
     - `runtime` to inject values from later steps (e.g. automation outputs).
   - Optionally add metadata JSON for runtime consumers.
2. Saving the product persists the assignment via the FastAPI configuration payload:
   ```json
   {
     "journeyComponents": [
       {
         "componentId": "uuid",
         "displayOrder": 0,
         "isRequired": true,
         "channelEligibility": ["storefront"],
         "bindings": [
           {"kind": "product_field", "inputKey": "orderId", "path": "order.id"}
         ],
         "metadata": {"drawer": "primary"}
       }
     ]
   }
   ```

## Triggering Runs
Use the runtime endpoint when you need to execute a component immediately (checkout server action, admin preview, automation backfill):

```http
POST /api/v1/journey-components/run
{
  "componentId": "uuid",
  "productId": "uuid",
  "channel": "storefront",
  "inputPayload": {"orderId": "ord_123"},
  "metadata": {"initiator": "checkout"},
  "context": {"preview": true}
}
```

The API validates that:
- The component exists.
- Optional product/productComponent references are valid.
- Channel eligibility matches the attachment (if provided).

### Built-in surfaces

- **Checkout**: `/app/api/checkout/route.ts` fetches `GET /api/v1/products/{id}/journeys`, filters channel eligibility, and enqueues runs with checkout metadata.
- **Admin preview**: `/admin/products` now exposes a “Run component” control per assignment. The server action (`apps/web/src/app/(admin)/admin/products/journey-actions.ts`) wraps `triggerJourneyComponentRun` with `channel=admin_preview`, so operators can queue automation steps without leaving the composer.
- **Orders automation**: `/admin/orders` includes a “Journey automation” form that targets the selected order (all products or a specific SKU). The action (`runOrderJourneyAutomationAction`) filters attachments whose triggers include `automation`, `post_checkout`, or `operator`, then enqueues runs with a snapshot of the order payload. Use this for backfills or manual reruns when fulfillment teams need to rehydrate downstream automations.

A `journey_component_runs` row is created, status transitions to `queued`, and a Celery task (`journey_runtime.execute_component_run`) is dispatched when `JOURNEY_RUNTIME_WORKER_ENABLED=true`.

## Monitoring & History
`GET /api/v1/products/{productId}/journeys` returns:
- Serialized `journeyComponents` (bindings, metadata, definitions) for the product.
- `recentRuns` – the latest run records (status, timestamps, result/error payloads).

Use this endpoint to power admin observability cards or troubleshoot stuck runs. Each run stores:
- Resolved bindings (`bindingSnapshot`).
- Input payload/metadata/context.
- Status lifecycle timestamps (`queuedAt`, `startedAt`, `completedAt`).
- Result payloads or failure reasons.

## Worker Notes
- Configure Celery queues via `.env`: `JOURNEY_RUNTIME_WORKER_ENABLED`, `JOURNEY_RUNTIME_TASK_QUEUE`.
- When `JOURNEY_RUNTIME_WORKER_ENABLED=true` and a Celery broker is configured, runs are pushed to the `journey-runtime` queue (`journey_runtime.execute_component_run` task).
- If the broker is absent, the in-process `JourneyRuntimeWorker` polls `journey_component_runs` on the FastAPI instance. Control polling via `JOURNEY_RUNTIME_POLL_INTERVAL_SECONDS` (default 5s) and `JOURNEY_RUNTIME_BATCH_SIZE` (default 10).
- Configure the external script host via `JOURNEY_RUNTIME_RUNNER_URL` (optionally `JOURNEY_RUNTIME_RUNNER_API_KEY` + `JOURNEY_RUNTIME_RUNNER_TIMEOUT_SECONDS`). When unset, the executor falls back to the `EchoJourneyScriptRunner` so local environments can keep developing without the remote runtime.
- `smplat_api/tasks/journey_runtime.py` resolves bindings, posts the structured payload to the configured runner, and records telemetry (latency, bindings count, output/error previews) alongside `resultPayload`. Missing required bindings still surface `FAILED` statuses and respect the component-level `retryPolicy`.
- `JourneyRuntimeService` requeues failed runs when `retryPolicy.maxAttempts` allows a retry, so Celery/local workers automatically pick them up again.
- The storefront checkout proxy (`apps/web/src/app/api/checkout/route.ts`) now calls `GET /api/v1/products/{id}/journeys` for each cart line and enqueues `POST /api/v1/journey-components/run` once the order + payment succeed, injecting `input.order`, `input.orderItems`, `input.cart`, and `context.checkout` payloads so bindings can react to checkout metadata.

## Execution Flow & Binding Resolution

1. `JourneyRuntimeService.create_run` stores the normalized binding snapshot (either from the request payload or the product attachment) alongside metadata/context.
2. `process_journey_run` marks the row as `running`, reloads the run with component/product context, and hands it to `JourneyRuntimeExecutor`.
3. Bindings are resolved in the following order:
   - `static`: literal `value`.
   - `product_field`: dot-path lookup on `product`, `productComponent`, or `component` snapshots (e.g., `product.slug`, `productComponent.metadata.drawer`).
   - `runtime`: dot-path lookup on runtime payloads (prefix with `input.`, `context.`, `metadata.`, or `trigger.`).
   Required bindings that cannot be resolved force a failure so retries/telemetry stay accurate.
4. The executor produces a `JourneyScriptRequest` that includes:
   - Component metadata (`scriptSlug`, `scriptRuntime`, etc.).
   - Resolved bindings + original `bindingSnapshot`.
   - Product/productComponent snapshots and the normalized input/context/metadata payloads.
5. When `JOURNEY_RUNTIME_RUNNER_URL` is set, `HttpJourneyScriptRunner` POSTs the payload to that endpoint (with optional bearer token). Otherwise the development echo runner mirrors inputs so downstream code paths stay testable.
6. Successful results persist in `result_payload`. Failures capture `error_message`, and the executor stores telemetry JSON (`runner`, `latencyMs`, `bindingsCount`, `outputPreview` / `errorPreview`) so admin surfaces and logs can summarize each run. `retryPolicy` is evaluated; when more attempts remain the run returns to `queued` and the worker logs a retry notice.

### Manual Processing

- Kick off a single run manually:

  ```bash
  poetry run python -c "import asyncio; from uuid import UUID; from smplat_api.tasks.journey_runtime import process_journey_run; asyncio.run(process_journey_run(UUID('run-id-here')))"
  ```

- Trigger the in-process worker loop during development by setting `JOURNEY_RUNTIME_WORKER_ENABLED=true` without a Celery broker; FastAPI will boot the worker when the app starts.
