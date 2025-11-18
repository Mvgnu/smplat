# Storefront Loyalty Context

The checkout experience now propagates loyalty telemetry through every downstream integration so runtime journey scripts, success pages, and account history have a consistent contract.

## Journey Context Shape

`journeyContext.cart` is an array of snapshot entries created at checkout time. Every entry contains:

- `productId`, `slug`, `quantity`, `trustSignal`, `journeyInsight`, `highlights`, and `sla` – taken directly from the customer-facing storefront experience.
- `loyaltyHint` – the storefront hint plus a normalized `pointsEstimate` number (or `null` when a product has no estimate). Scripts should read this value rather than re-deriving from price metadata.
- `pointsTotal` – per-line projection computed as `pointsEstimate * quantity`. This is always a number or `null`, letting downstream payloads sum totals without guarding against `undefined`.
- `platformContext` – when a shopper sets a platform in the shared store, each cart line carries `{ id, label, handle?, platformType? }` so checkouts, success pages, and loyalty dashboards can reason about per-channel purchases.

`journeyContext.loyaltyProjection.projectedPoints` tracks the entire cart estimate and mirrors what the UI surfaces at checkout and on the success page.

`journeyContext.pricingExperiments` (array) captures any pricing trials that influenced the cart during checkout. Each entry includes:

- `slug`, `status`, `assignmentStrategy`, `targetProductSlug`, and `featureFlagKey` (mirroring the FastAPI snapshot).
- `sourceProductSlugs` – all product slugs in the cart that mapped to this experiment; downstream scripts can quickly scope messaging to the affected SKUs.
- `assignedVariantKey`, `assignedVariantName`, and `assignedVariantIsControl` – the storefront’s assignment heuristic so loyalty/journey automation can reference the exact variant customers saw.
- `lineTotalCents` and `quantity` – summed line totals from the cart so telemetry pipes can attribute revenue/conversions without rehydrating order payloads.
- `variants` – shallow copies of the configured variants (key, control flag, and adjustment metadata) for completeness.
- Storefront success/account pages read the same entries and only surface variant-specific copy when `status` is `running`/`paused` **and** the corresponding `featureFlagKey` is enabled. This keeps experimentation messaging aligned with feature flag rollouts.

The checkout API also embeds the same metadata per order item under `order.items[].attributes.pricingExperiment`, allowing receipts, success pages, and account history to annotate line items without parsing `journeyContext`.

## Order Payload & Receipts

- `order.items[].platform_context` now persists exactly what the storefront cart carried (`{ id, label, handle, platformType }`). FastAPI stores it alongside each `order_items` row and returns it in `/api/v1/orders*` responses.
- Checkout success + account orders now render “Platform” chips next to every line item using the stored context, so customers (and concierge teams) immediately see which handle/channel each purchase targeted.
- The same snapshot is forwarded to onboarding journey ingestion, meaning automation dashboards and Slack/automation runs can key off `"platform_contexts"` inside the journey context (`OnboardingService.ingest_success_payload` merges the camelCase payload into `journey.context.platform_contexts`).
- Runbooks + telemetry exporters should prefer the structured `platform_context` JSON instead of scraping labels from notes or storefront state—this keeps automation, guardrail follow-ups, and loyalty dashboards aligned even when the storefront evolves.

## Shared Storefront State & URL Schema

Front-end clients now share a single persisted store in `@/context/storefront-state`. The provider wraps the global layout so storefront, account, and admin surfaces can read/write a consistent snapshot containing:

- `platform`: `{ id, label, handle?, platformType? }` representing the customer’s currently scoped platform or saved handle.
- `loyaltySnapshot`: `{ projectedPoints, tier, expiresAt, loyaltyCampaign, lastUpdatedAt }` mirroring the projections exposed at checkout/success.
- `experimentExposure`: `{ slug, variantKey, variantName?, isControl?, guardrailStatus?, exposedAt? }` describing the latest active experiment context.

State writes persist to both `localStorage` and a `smplat_storefront_state` cookie, enabling SSR hydration and downstream server components (e.g., platform-aware navigation) to default to the user’s last context.

To keep deep links and multi-surface routing aligned, we standardized storefront query parameters in `@/lib/storefront-query.ts`:

| Param | Purpose | Example |
| --- | --- | --- |
| `platform` | Platform identifier or saved handle | `?platform=instagram` or `?platform=@brand_handle` |
| `experiment` | Pricing experiment slug | `?experiment=pricing-drop-a` |
| `variant` | Variant key for the experiment | `?variant=v2-premium` |
| `loyaltyCampaign` | Loyalty/intent program slug | `?loyaltyCampaign=q1-promo` |

The shared store automatically hydrates from these params on first render, so any storefront/admin deep link can scope the page to the correct platform, loyalty campaign, and experiment exposure without duplicating parsing logic.

Cart, product detail, and the Loyalty Hub now read/write this store so shoppers see the current platform context alongside CTAs (“Browse more {platform} products”, “Clear context”). These surfaces link to `/products` with the standardized query params, ensuring routing stays aligned with the saved selection.

## Runtime Usage

`/api/checkout` forwards the normalized `journeyContext` when triggering journey runtimes:

```ts
inputPayload: {
  order,
  orderItems,
  cart, // normalized snapshot incl. loyaltyHint.pointsEstimate + pointsTotal
  form,
  loyalty,
  loyaltyProjection,
  cartPointsTotal, // convenience sum of all line item points
  intents,
  rewards
}
```

Scripts can now read `payload.inputPayload.cart[n].pointsTotal` or `payload.inputPayload.loyaltyProjection.projectedPoints` to personalize messaging, award bonuses, or seed loyalty automations without recomputing raw values.

## Order Notes Convention

Checkout now persists a structured `loyalty_projection_points` column on every order alongside the legacy `loyaltyProjection=<points>` note snippet (kept for human-readable auditing). The FastAPI `/api/v1/orders` endpoints emit the stored value as `loyaltyProjectionPoints`, so storefront and admin clients should always read that column rather than attempting to parse notes. Treat the structured value as informational only—automations should continue to rely on `journeyContext` for authoritative numbers.

## Notifications & Lifecycle Emails

`NotificationService` templates (order status updates, payment receipts, fulfillment alerts) read `order.items[].attributes.pricingExperiment` and render the same “Triggered by {variant}” context the storefront surfaces. When experiment metadata is present, emails now include a short list of active experiments (slug/name, variant, control/challenger, status, assignment strategy) plus links back to the dashboard. This keeps concierge scripts, automated reminders, and loyalty digests aligned with the UI and exports described above. No additional configuration is required as long as checkout continues to populate the pricing experiment attributes.
