# Storefront Loyalty Context

The checkout experience now propagates loyalty telemetry through every downstream integration so runtime journey scripts, success pages, and account history have a consistent contract.

## Journey Context Shape

`journeyContext.cart` is an array of snapshot entries created at checkout time. Every entry contains:

- `productId`, `slug`, `quantity`, `trustSignal`, `journeyInsight`, `highlights`, and `sla` – taken directly from the customer-facing storefront experience.
- `loyaltyHint` – the storefront hint plus a normalized `pointsEstimate` number (or `null` when a product has no estimate). Scripts should read this value rather than re-deriving from price metadata.
- `pointsTotal` – per-line projection computed as `pointsEstimate * quantity`. This is always a number or `null`, letting downstream payloads sum totals without guarding against `undefined`.

`journeyContext.loyaltyProjection.projectedPoints` tracks the entire cart estimate and mirrors what the UI surfaces at checkout and on the success page.

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
