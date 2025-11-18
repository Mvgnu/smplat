# Order State Machine & Delivery Proof

Track 0 now exposes a fully-audited order timeline plus delivery proof snapshots so operators can supervise fulfillment from `/admin/orders` without digging into raw data.

## State Machine

| From | Allowed To | Notes |
| --- | --- | --- |
| `pending` | `processing`, `active`, `completed`, `canceled` | Admin overrides can skip straight to completed for manual provisioning. |
| `processing` | `active`, `completed`, `on_hold`, `canceled` | Reflects provider intake failures or manual holds. |
| `active` | `completed`, `on_hold`, `canceled` | Represents live delivery. |
| `on_hold` | `processing`, `active`, `canceled` | Used for fraud checks or provider failover. |
| `completed` | `active` | Allows refills / reopen when SLA missed. |
| `canceled` | — | Terminal. |

Every transition is persisted to `order_state_events` with:

- `event_type`: `state_change`, `refill_requested`, `refund_completed`, etc.
- `actor_type`: `system`, `operator`, `admin`, `automation`, `provider`.
- Metadata + notes describing the context.

### API Surface

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/v1/orders/{id}/status` | `PATCH` | Performs a state transition (requires `X-API-Key`). Payload accepts `status`, optional `notes`, `actorType`, `actorLabel`, and `metadata`. |
| `/api/v1/orders/{id}/state-events` | `GET` | Returns the audit trail in reverse chronological order. |

Admin tooling now calls the patched endpoint and renders the audit trail in `/admin/orders` (“Order timeline” card).

## Delivery Proof

`customer_social_accounts` + `order_items.customer_social_account_id` allow delivery snapshots to travel with each order item. New endpoint:

```
GET /api/v1/orders/{id}/delivery-proof
Authorization: X-API-Key: $CHECKOUT_API_KEY
```

returns:

```jsonc
{
  "orderId": "…",
  "generatedAt": "2025-01-05T12:00:00Z",
  "items": [
    {
      "itemId": "…",
      "productTitle": "Instagram Growth",
      "account": {
        "handle": "brand",
        "platform": "instagram",
        "verificationStatus": "verified"
      },
      "baseline": { "metrics": { "followerCount": 1200 }, "source": "scraper" },
      "latest": { "metrics": { "followerCount": 1500 }, "source": "scraper" },
      "history": [ … ]
    }
  ]
}
```

The admin UI surfaces this under “Delivery proof”, showing baseline vs latest metrics (plus raw JSON) for each item. Operators can confirm before/after growth before sharing proof with customers.

`GET /api/v1/orders/delivery-proof/metrics` now aggregates those snapshots per product so storefront surfaces can quote real follower lift, sample sizes, and last-captured timestamps. Pass `productId` (repeatable) to scope the response to specific SKUs; the payload reports sample counts, average baseline/latest values, delta deltas, and human-readable strings that storefront trust components reuse. This feed powers checkout trust badges, PDP metrics, and the trust preview tooling without duplicating SQL in Next.js.

## Operations Workflow

1. **Validate account** via `/admin/reports → Metric sourcing testbed` to persist baseline snapshots.
2. **Link social account** to the order item (via existing provisioning tool) so the backend records delivery snapshots as fulfillment progresses.
3. **Manage states** from `/admin/orders` using the updated status form (notes are required for overrides). The timeline instantly reflects every transition with actor + timestamp.
4. **Share proof** by copying snapshots from the “Delivery proof” card or exporting via CLI/Next.js once the UI confirms delivery.
5. **Trigger provider interventions** from `/admin/fulfillment/providers`. Manual refills now add `refill_completed` entries to the timeline automatically so CX + ops can see who nudged the provider, when, and for how much (replay hooks follow next).

See also:

- [`docs/metric-sourcing.md`](./metric-sourcing.md) for account validation details.
- [`docs/runbooks/account-validation.md`](./runbooks/account-validation.md) for operator procedures.
