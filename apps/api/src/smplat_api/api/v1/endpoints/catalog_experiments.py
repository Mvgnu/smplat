"""API endpoints for catalog bundle experiments."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.catalog_experiments import CatalogBundleExperimentStatus
from smplat_api.services.catalog.experiments import CatalogExperimentService, ExperimentSnapshot


router = APIRouter(prefix="/catalog/experiments", tags=["Catalog"])


class ExperimentVariantPayload(BaseModel):
    """Payload describing an experiment variant."""

    key: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=150)
    weight: int = Field(default=0, ge=0, le=10_000)
    is_control: bool = False
    bundle_slug: str | None = Field(default=None, max_length=150)
    override_payload: dict[str, Any] = Field(default_factory=dict)


class ExperimentCreateRequest(BaseModel):
    """Request body for creating experiments."""

    slug: str = Field(..., min_length=1, max_length=150)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    guardrail_config: dict[str, Any] = Field(default_factory=dict)
    sample_size_guardrail: int = Field(default=0, ge=0, le=1_000_000)
    variants: list[ExperimentVariantPayload] = Field(default_factory=list)


class ExperimentUpdateRequest(BaseModel):
    """Payload for updating experiment metadata."""

    status: CatalogBundleExperimentStatus | None = None
    guardrail_config: dict[str, Any] | None = None
    sample_size_guardrail: int | None = Field(default=None, ge=0, le=1_000_000)


class ExperimentMetricResponse(BaseModel):
    """Telemetry payload for a variant."""

    window_start: date
    lookback_days: int
    acceptance_rate: float
    acceptance_count: int
    sample_size: int
    lift_vs_control: float | None = None
    guardrail_breached: bool
    computed_at: datetime


class ExperimentVariantResponse(BaseModel):
    """Experiment variant representation including metrics."""

    key: str
    name: str
    weight: int
    is_control: bool
    bundle_slug: str | None
    override_payload: dict[str, Any]
    metrics: list[ExperimentMetricResponse] = Field(default_factory=list)


class ExperimentResponse(BaseModel):
    """Experiment payload with variants and provenance."""

    slug: str
    name: str
    description: str | None
    status: CatalogBundleExperimentStatus
    guardrail_config: dict[str, Any]
    sample_size_guardrail: int
    variants: list[ExperimentVariantResponse]
    provenance: dict[str, Any]


class GuardrailEvaluationResponse(BaseModel):
    """Guardrail evaluation envelope."""

    experiment: str
    breaches: list[dict[str, Any]]
    evaluated_at: datetime


async def get_experiment_service(session: AsyncSession = Depends(get_session)) -> CatalogExperimentService:
    """Resolve the catalog experiment service from the session."""

    return CatalogExperimentService(session)


def _serialize_experiment(snapshot: ExperimentSnapshot) -> ExperimentResponse:
    return ExperimentResponse(
        slug=snapshot.slug,
        name=snapshot.name,
        description=snapshot.description,
        status=snapshot.status,
        guardrail_config=snapshot.guardrail_config,
        sample_size_guardrail=snapshot.sample_size_guardrail,
        variants=[
            ExperimentVariantResponse(
                key=variant.key,
                name=variant.name,
                weight=variant.weight,
                is_control=variant.is_control,
                bundle_slug=variant.bundle_slug,
                override_payload=variant.override_payload,
                metrics=[
                    ExperimentMetricResponse(
                        window_start=metric.window_start,
                        lookback_days=metric.lookback_days,
                        acceptance_rate=metric.acceptance_rate,
                        acceptance_count=metric.acceptance_count,
                        sample_size=metric.sample_size,
                        lift_vs_control=metric.lift_vs_control,
                        guardrail_breached=metric.guardrail_breached,
                        computed_at=metric.computed_at,
                    )
                    for metric in variant.metrics
                ],
            )
            for variant in snapshot.variants
        ],
        provenance=snapshot.provenance,
    )


@router.get(
    "",
    response_model=list[ExperimentResponse],
    dependencies=[Depends(require_checkout_api_key)],
)
async def list_catalog_experiments(
    service: CatalogExperimentService = Depends(get_experiment_service),
) -> list[ExperimentResponse]:
    """Return all catalog bundle experiments."""

    snapshots = await service.list_experiments()
    return [_serialize_experiment(snapshot) for snapshot in snapshots]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ExperimentResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def create_catalog_experiment(
    payload: ExperimentCreateRequest,
    service: CatalogExperimentService = Depends(get_experiment_service),
) -> ExperimentResponse:
    """Create a new experiment with variants."""

    try:
        snapshot = await service.create_experiment(
            slug=payload.slug,
            name=payload.name,
            description=payload.description,
            guardrail_config=payload.guardrail_config,
            sample_size_guardrail=payload.sample_size_guardrail,
            variants=[variant.model_dump() for variant in payload.variants],
        )
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)


@router.put(
    "/{slug}",
    response_model=ExperimentResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def update_catalog_experiment(
    slug: str,
    payload: ExperimentUpdateRequest,
    service: CatalogExperimentService = Depends(get_experiment_service),
) -> ExperimentResponse:
    """Update experiment metadata and guardrails."""

    try:
        snapshot = await service.update_experiment(
            slug,
            status=payload.status,
            guardrail_config=payload.guardrail_config,
            sample_size_guardrail=payload.sample_size_guardrail,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)


@router.post(
    "/{slug}/evaluate",
    response_model=GuardrailEvaluationResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def evaluate_experiment_guardrails(
    slug: str,
    service: CatalogExperimentService = Depends(get_experiment_service),
) -> GuardrailEvaluationResponse:
    """Evaluate guardrail breaches for the experiment."""

    try:
        payload = await service.evaluate_guardrails(slug)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return GuardrailEvaluationResponse(**payload)


@router.post(
    "/{slug}/publish",
    response_model=ExperimentResponse,
    dependencies=[Depends(require_checkout_api_key)],
)
async def publish_experiment_overrides(
    slug: str,
    service: CatalogExperimentService = Depends(get_experiment_service),
) -> ExperimentResponse:
    """Mark an experiment as running and expose latest overrides."""

    try:
        snapshot = await service.publish_overrides(slug)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _serialize_experiment(snapshot)


__all__ = [
    "router",
]
