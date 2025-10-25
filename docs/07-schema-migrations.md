# Database ERD & Migration Roadmap

## ERD Highlights
```
User (id PK)
 ├─ CustomerProfile (id PK, user_id FK)
 ├─ Session (id PK, user_id FK)
 ├─ Order (id PK, user_id FK)
 │    ├─ OrderItem (id PK, order_id FK, product_id FK?)
 │    │    └─ FulfillmentTask (id PK, order_item_id FK)
 │    ├─ Payment (id PK, order_id FK, stripe_payment_intent_id UNIQUE)
 │    ├─ Invoice (id PK, order_id FK)
 │    │    └─ LexofficeSyncLog (id PK, invoice_id FK)
 │    └─ OrderEvent (id PK, order_id FK)
 ├─ Subscription (id PK, user_id FK, subscription_plan_id FK)
 ├─ Notification (id PK, user_id FK)
 └─ SupportTicket (id PK, user_id FK)

Product (id PK)
 ├─ ProductVariant (id PK, product_id FK)
 ├─ ProductOptionGroup (id PK, product_id FK)
 │    └─ ProductOption (id PK, group_id FK)
 └─ SubscriptionPlan (id PK, product_id FK, stripe_price_id UNIQUE)

Cart (id PK, user_id FK nullable, session_id)
IntegrationCredential (id PK, owner_type ENUM, owner_id, service ENUM)
InstagramAccountSnapshot (id PK, customer_profile_id FK, recorded_at)
WebhookEvent (id PK, provider ENUM, external_id UNIQUE)
AuditLog (id PK, actor_user_id FK)
GDPRRequest (id PK, user_id FK)
```

## Naming Standards
- Table names snake_case pluralized (e.g., `users`, `orders`).
- Primary keys `id` as UUIDv7 (ordered UUID).
- Timestamps: `created_at`, `updated_at` with timezone (`TIMESTAMPTZ`).
- Soft-delete via `deleted_at` where needed (e.g., products, options).
- Unique constraints for natural keys (e.g., `orders.order_number`, `products.slug`).

## Migration Strategy
- Use Alembic with versioned migrations; maintain `versions/` folder grouped by domain (e.g., `auth`, `orders`).
- Initial baseline migration seeds core tables (`users`, `sessions`, `products`, `orders`, `payments`, `invoices`, `subscriptions`).
- Subsequent migrations follow feature workstreams (e.g., `lexoffice`, `support`).
- Enforce SQLAlchemy metadata alignment with automap tests to detect drift.

### Current Migration Log
- `20251015_01_initial_user_table` – User accounts and enums (roles, status).
- `20251015_02_customer_profile_notifications` – Customer profiles, notification scaffolding, shared currency enum.
- `20251015_03_commerce_core` – Products, option groups, orders, order items, payments.
- `20251015_04_fulfillment_tables` – Fulfillment tasks, Instagram accounts/analytics, service campaigns, campaign activities.
- `20251015_05_product_configuration` – Configurable product structures (option group types, add-ons, custom fields, subscription plans).

## Indexing Plan
- `orders`: index `user_id`, `status`, `created_at`.
- `payments`: unique on `stripe_payment_intent_id`; index `status`.
- `subscriptions`: unique on `stripe_subscription_id`; index `user_id`.
- `instagram_account_snapshots`: composite index `(customer_profile_id, recorded_at DESC)`.
- `webhook_events`: unique `(provider, external_id)`; index `processed_at`.
- Full-text search indexes for `support_tickets` and marketing content (future).

## Seed & Fixtures
- Create seed script for reference data (roles, product categories, VAT rates).
- Use Alembic data migrations or dedicated seeding CLI (FastAPI management command).

## Testing
- PyTest fixtures spin up ephemeral Postgres (via Docker) with Alembic head.
- Snapshot tests for schema using `pytest-alembic`.
- Integration tests verifying Stripe webhook → order creation transaction boundaries.

## Next Implementation Steps
1. Draft SQLAlchemy models mirroring `docs/04-data-model.md` (in progress; `User`, `CustomerProfile`, `Notification`, `Product`, `Order`, `Payment` models scaffolded).
2. Configure Alembic env with async engine, multiple metadata targets (core + auth) (✅ env.py in place).
3. Generate baseline migration and review for indexes/constraints (✅ migrations `20251015_01_initial_user_table`, `20251015_02_customer_profile_notifications`, `20251015_03_commerce_core`).
4. Align Prisma schema (for Auth.js) with shared Postgres DB; document table ownership. ✅ (`apps/web/prisma/schema.prisma`).
5. Establish migration policy (manual review, code owners) and CI gate requiring Alembic upgrade/downgrade success.
