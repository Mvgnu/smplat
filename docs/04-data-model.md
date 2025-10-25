# Data Model Outline

## Core Entities
- **User**
  - Fields: `id`, `email`, `password_hash`, `display_name`, `role` (`client`, `admin`, `finance`), `status`, timestamps.
  - Relationships: 1:N with `CustomerProfile`, `Sessions`, `Orders`, `SupportTicket`.
- **CustomerProfile**
  - Represents client-specific metadata (company info, VAT ID, invoice address, preferred currency, Instagram handle).
  - Links `user_id` and stores GDPR consent flags.
- **Session / AuthToken**
  - Supports Auth.js session persistence (session token, expiry, user agent, IP, device metadata).
- **Product**
  - Fields: `id`, `slug`, `title`, `description`, `category`, `is_active`, `base_price`, `currency`, `tax_rate`, `display_order`.
  - Relationships: 1:N with `ProductOptionGroup`, `ProductVariant`, `ProductMedia`, `ProductMetadata`.
- **ProductOptionGroup**
  - Configurable option collections (e.g., target audience, speed, add-ons) with ordering rules.
- **ProductOption**
  - Individual option values with price deltas, constraints, and compatibility flags.
- **SubscriptionPlan**
  - Stripe price linkage, billing interval, trial days, linked `product_id`.

## Commerce Entities
- **Cart**
  - Temporary context for checkout; stores `client_reference_id`, `session_id`, selected products/options, pricing snapshot.
- **Order**
  - Fields: `id`, `order_number`, `user_id`, `status` (`pending`, `processing`, `active`, `completed`, `on_hold`, `canceled`), `subtotal`, `tax`, `total`, `currency`, `source` (`checkout`, `manual`), timestamps.
  - Relationships: 1:N with `OrderItem`, `Payment`, `Invoice`, `OrderEvent`, `Fulfillment`.
- **OrderItem**
  - Contains product snapshot, option selections, fulfillment metadata (account handles, campaign goals).
- **Payment**
  - Stripe payment intent/charge references, amount, currency, status, failure reasons.
- **Subscription**
  - Links to Stripe subscription ID, plan, current period dates, status, renewal flags.
- **Invoice**
  - Stores invoice number, PDF path, tax breakdown, customer info, due dates, Lexoffice sync status.
- **LexofficeSyncLog**
  - Tracks pushes to Lexoffice (entity type, payload hash, status, response, retry count).

## Fulfillment & Integrations
- **FulfillmentTask**
  - Represents discrete steps (e.g., "Queue Instagram promotion API call"). Contains `order_item_id`, `type`, `payload`, `status`, scheduled timestamps.
- **IntegrationCredential**
  - Stores OAuth tokens or API keys for external services (Instagram, Lexoffice) with encryption-at-rest.
- **InstagramAccountSnapshot**
  - Time-series metrics: followers, engagement rates, reach, impressions; linked to `customer_profile`.
- **WebhookEvent**
  - Inbound events from Stripe, Lexoffice, Instagram; ensures idempotency (`event_id`), payload, processing state.
- **Notification**
  - Tracks emails/SMS/push triggered, template ID, recipient, status, error message.

## Support & Compliance
- **SupportTicket**
  - Ticketing (subject, description, priority, status, assigned admin, chat transcript).
- **AuditLog**
  - Immutable log of sensitive actions (e.g., role changes, data exports) with actor, resource, diff.
- **GDPRRequest**
  - Data access/deletion requests and processing status.

## Diagram Overview (Conceptual)
```
User ──< CustomerProfile
   └──< Session
   └──< Order ──< OrderItem ──< FulfillmentTask
                └──< Payment
                └──< Invoice ──< LexofficeSyncLog
                └──< OrderEvent
SubscriptionPlan ──< Subscription
Product ──< ProductOptionGroup ──< ProductOption
Product ──< ProductVariant

CustomerProfile ──< InstagramAccountSnapshot
Order ──< Notification
WebhookEvent (idempotent processing for Stripe/Lexoffice)
SupportTicket ──< Notification
AuditLog (global actor/resource log)
```

## Next Steps
1. Convert outline into detailed ERD with relationships, cardinality, indexes.
2. Define naming conventions, schemas, and initial Alembic migration plan.
3. Identify required composite indexes (e.g., `order_number`, `subscription_id`, `webhook_event_id`).
4. Map Stripe objects to internal records (payment intent ↔ payment table).
