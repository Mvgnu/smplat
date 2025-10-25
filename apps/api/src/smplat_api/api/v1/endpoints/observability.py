"""Observability endpoints for catalog search and Prometheus metrics."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.observability.catalog import get_catalog_store
from smplat_api.observability.fulfillment import get_fulfillment_store
from smplat_api.observability.payments import get_payment_store


router = APIRouter(prefix="/observability", tags=["Observability"])


class CatalogSearchEvent(BaseModel):
    query: str | None = Field(default=None, description="Search query string")
    category: str | None = Field(default=None, description="Category filter applied by the user")
    sort: str = Field(default="featured", description="Sort option selected by the user")
    results_count: int = Field(..., description="Number of results returned to the user")


@router.post(
    "/catalog-search",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Record catalog search interaction",
)
async def record_catalog_search(event: CatalogSearchEvent) -> dict[str, str]:
    """Record a catalog search interaction for observability purposes."""
    if event.results_count < 0:
        raise HTTPException(status_code=400, detail="results_count must be non-negative")

    store = get_catalog_store()
    store.record_search(
        query=event.query,
        category=event.category,
        sort=event.sort,
        results_count=event.results_count,
    )
    return {"status": "accepted"}


@router.get(
    "/catalog-search",
    dependencies=[Depends(require_checkout_api_key)],
    summary="Catalog search observability snapshot",
)
async def get_catalog_search_snapshot() -> dict[str, object]:
    """Retrieve aggregated catalog search metrics (requires checkout API key)."""
    store = get_catalog_store()
    return store.snapshot().as_dict()


def _format_metric(name: str, description: str, value: int | float, labels: dict[str, str] | None = None) -> list[str]:
    label_fragment = ""
    if labels:
        formatted = ",".join(f'{key}="{val}"' for key, val in sorted(labels.items()))
        label_fragment = f"{{{formatted}}}"
    return [
        f"# HELP {name} {description}",
        f"# TYPE {name} gauge",
        f"{name}{label_fragment} {value}",
    ]


@router.get(
    "/prometheus",
    dependencies=[Depends(require_checkout_api_key)],
    summary="Prometheus-formatted observability metrics",
    response_class=PlainTextResponse,
)
async def get_prometheus_metrics() -> PlainTextResponse:
    fulfillment_snapshot = get_fulfillment_store().snapshot().as_dict()
    payments_snapshot = get_payment_store().snapshot().as_dict()
    catalog_snapshot = get_catalog_store().snapshot().as_dict()

    lines: list[str] = []

    totals = fulfillment_snapshot.get("totals", {})
    lines.extend(
        _format_metric("smplat_fulfillment_tasks_processed_total", "Fulfillment tasks processed", totals.get("processed", 0))
    )
    lines.extend(
        _format_metric("smplat_fulfillment_tasks_failed_total", "Fulfillment tasks failed", totals.get("failed", 0))
    )
    lines.extend(
        _format_metric("smplat_fulfillment_tasks_dead_lettered_total", "Fulfillment tasks transitioned to dead-letter", totals.get("dead_lettered", 0))
    )
    lines.extend(
        _format_metric("smplat_fulfillment_tasks_retried_total", "Fulfillment tasks scheduled for retry", totals.get("retried", 0))
    )

    per_type: dict[str, dict[str, int]] = fulfillment_snapshot.get("per_task_type", {})
    for bucket, counts in per_type.items():
        for task_type, value in counts.items():
            lines.extend(
                _format_metric(
                    "smplat_fulfillment_tasks_total",
                    "Fulfillment task counts grouped by bucket",
                    value,
                    labels={"bucket": bucket, "task_type": task_type},
                )
            )

    checkout_totals = payments_snapshot.get("checkout", {}).get("totals", {})
    lines.extend(
        _format_metric("smplat_payments_checkout_succeeded_total", "Checkout sessions succeeded", checkout_totals.get("succeeded", 0))
    )
    lines.extend(
        _format_metric("smplat_payments_checkout_failed_total", "Checkout sessions failed", checkout_totals.get("failed", 0))
    )

    webhook_totals = payments_snapshot.get("webhooks", {}).get("totals", {}) or {}
    for bucket, counts in webhook_totals.items():
        for event_type, value in counts.items():
            lines.extend(
                _format_metric(
                    "smplat_payments_webhook_events_total",
                    "Stripe webhook events grouped by outcome",
                    value,
                    labels={"bucket": bucket, "event_type": event_type},
                )
            )

    catalog_totals = catalog_snapshot.get("totals", {})
    lines.extend(
        _format_metric("smplat_catalog_search_total", "Catalog search interactions", catalog_totals.get("searches", 0))
    )
    lines.extend(
        _format_metric(
            "smplat_catalog_results_returned_total",
            "Total catalog results returned to clients",
            catalog_totals.get("results_returned", 0),
        )
    )

    for category, value in catalog_snapshot.get("categories", {}).items():
        lines.extend(
            _format_metric(
                "smplat_catalog_search_category_total",
                "Catalog searches by category",
                value,
                labels={"category": category},
            )
        )

    for sort, value in catalog_snapshot.get("sorts", {}).items():
        lines.extend(
            _format_metric(
                "smplat_catalog_search_sort_total",
                "Catalog searches by sort option",
                value,
                labels={"sort": sort},
            )
        )

    for query, value in catalog_snapshot.get("queries", {}).items():
        lines.extend(
            _format_metric(
                "smplat_catalog_search_query_total",
                "Top catalog search queries",
                value,
                labels={"query": query},
            )
        )

    for query, value in catalog_snapshot.get("zero_result_queries", {}).items():
        lines.extend(
            _format_metric(
                "smplat_catalog_zero_result_query_total",
                "Catalog searches that returned zero results, grouped by query",
                value,
                labels={"query": query},
            )
        )

    lines.extend(
        _format_metric(
            "smplat_catalog_zero_results_total",
            "Catalog searches that returned zero results",
            catalog_totals.get("zero_results", 0),
        )
    )

    catalog_metrics = catalog_snapshot.get("metrics", {})
    lines.extend(
        _format_metric(
            "smplat_catalog_zero_results_rate",
            "Ratio of catalog searches returning zero results",
            catalog_metrics.get("zero_results_rate", 0.0),
        )
    )
    lines.extend(
        _format_metric(
            "smplat_catalog_average_results_per_search",
            "Average number of catalog results returned per search",
            catalog_metrics.get("average_results_per_search", 0.0),
        )
    )

    body = "\n".join(lines) + "\n"
    return PlainTextResponse(content=body, media_type="text/plain; version=0.0.4")
