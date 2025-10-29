from fastapi import APIRouter

from .endpoints import (
    auth,
    billing,
    billing_reconciliation,
    billing_reports,
    billing_sessions,
    billing_replay,
    billing_webhooks,
    catalog_merchandising,
    catalog_recommendations,
    catalog_experiments,
    fulfillment,
    health,
    instagram,
    observability,
    orders,
    onboarding,
    operator_onboarding,
    payments,
    products,
    trust,
    loyalty,
)

router = APIRouter()
router.include_router(health.router, tags=["Health"])
router.include_router(auth.router)
router.include_router(products.router)
router.include_router(payments.router)
router.include_router(orders.router)
router.include_router(onboarding.router)
router.include_router(operator_onboarding.router)
router.include_router(billing.router)
router.include_router(billing_sessions.router)
router.include_router(billing_reports.router)
router.include_router(billing_reconciliation.router)
router.include_router(billing_replay.router)
router.include_router(billing_webhooks.router)
router.include_router(catalog_recommendations.router)
router.include_router(catalog_experiments.router)
router.include_router(catalog_merchandising.router)
router.include_router(observability.router)
router.include_router(fulfillment.router, tags=["Fulfillment"])
router.include_router(instagram.router)
router.include_router(trust.router)
router.include_router(loyalty.router)
