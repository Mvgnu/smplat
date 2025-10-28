from fastapi import APIRouter

from .endpoints import (
    billing,
    billing_reconciliation,
    billing_sessions,
    billing_replay,
    billing_webhooks,
    fulfillment,
    health,
    instagram,
    observability,
    orders,
    payments,
    products,
)

router = APIRouter()
router.include_router(health.router, tags=["Health"])
router.include_router(products.router)
router.include_router(payments.router)
router.include_router(orders.router)
router.include_router(billing.router)
router.include_router(billing_sessions.router)
router.include_router(billing_reconciliation.router)
router.include_router(billing_replay.router)
router.include_router(billing_webhooks.router)
router.include_router(observability.router)
router.include_router(fulfillment.router, tags=["Fulfillment"])
router.include_router(instagram.router)
