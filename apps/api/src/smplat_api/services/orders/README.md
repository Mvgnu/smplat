# Onboarding order services

This module centralizes order-adjacent service logic that is not tied to payments or fulfillment. The onboarding service persists client checklists, referral metadata, and operator interaction logs via SQLAlchemy models and FastAPI endpoints.

Key entry points:

- `onboarding.py` – orchestrates journey creation, task toggles, and analytics deltas.
- `/api/v1/orders/{order_id}/onboarding` – FastAPI router exposing journey fetch/update/referral endpoints.

> meta: docs: orders-onboarding-service
