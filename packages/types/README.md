# SMPLAT Shared Types

This package exposes shared TypeScript interfaces that span applications. Catalog bundle
recommendation types live under `src/catalog` and mirror the FastAPI response contracts.

## Loyalty

New loyalty and referral response contracts are exported from `src/loyalty` so storefront and
operator dashboards can hydrate UI components without duplicating type definitions. Checkout intent
models (`LoyaltyCheckoutIntent`, `LoyaltyNextActionCard`) coordinate cross-surface follow-up flows
between checkout, success, and the loyalty hub while keeping API and web clients aligned.
