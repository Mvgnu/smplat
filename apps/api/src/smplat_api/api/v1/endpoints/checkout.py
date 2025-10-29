"""Checkout orchestration API endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.api.dependencies.security import require_checkout_api_key
from smplat_api.db.session import get_session
from smplat_api.models.checkout import (
    CheckoutOrchestration,
    CheckoutOrchestrationEvent,
    CheckoutOrchestrationStage,
    CheckoutOrchestrationStatus,
)
from smplat_api.models.order import Order
from smplat_api.services.checkout import CheckoutOrchestrationService
from smplat_api.services.checkout.orchestrator import StageUpdate

router = APIRouter(prefix="/checkout", tags=["Checkout"], dependencies=[Depends(require_checkout_api_key)])


class CheckoutEventPayload(BaseModel):
    """Payload describing orchestration update input."""

    stage: CheckoutOrchestrationStage
    status: CheckoutOrchestrationStatus
    note: str | None = None
    payload: dict[str, Any] | None = None
    next_action_at: datetime | None = Field(None, alias="nextActionAt")
    metadata_patch: dict[str, Any] | None = Field(None, alias="metadataPatch")

    class Config:
        populate_by_name = True
        use_enum_values = True


class CheckoutEventResponse(BaseModel):
    stage: CheckoutOrchestrationStage
    status: CheckoutOrchestrationStatus
    note: str | None = None
    payload: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")

    class Config:
        populate_by_name = True
        use_enum_values = True


class CheckoutOrchestrationResponse(BaseModel):
    order_id: UUID = Field(alias="orderId")
    current_stage: CheckoutOrchestrationStage = Field(alias="currentStage")
    status: CheckoutOrchestrationStatus
    started_at: datetime | None = Field(None, alias="startedAt")
    completed_at: datetime | None = Field(None, alias="completedAt")
    failed_at: datetime | None = Field(None, alias="failedAt")
    next_action_at: datetime | None = Field(None, alias="nextActionAt")
    metadata: dict[str, Any] = Field(default_factory=dict)
    events: list[CheckoutEventResponse]

    class Config:
        populate_by_name = True
        use_enum_values = True


def _serialize_event(event: CheckoutOrchestrationEvent) -> CheckoutEventResponse:
    return CheckoutEventResponse(
        stage=event.stage,
        status=event.status,
        note=event.transition_note,
        payload=event.payload or {},
        createdAt=event.created_at,
    )


def _serialize_orchestration(orchestration: CheckoutOrchestration) -> CheckoutOrchestrationResponse:
    return CheckoutOrchestrationResponse(
        orderId=orchestration.order_id,
        currentStage=orchestration.current_stage,
        status=orchestration.stage_status,
        startedAt=orchestration.started_at,
        completedAt=orchestration.completed_at,
        failedAt=orchestration.failed_at,
        nextActionAt=orchestration.next_action_at,
        metadata=orchestration.metadata_json or {},
        events=[_serialize_event(event) for event in orchestration.events],
    )


@router.get("/orchestrations/{order_id}", response_model=CheckoutOrchestrationResponse)
async def get_checkout_orchestration(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CheckoutOrchestrationResponse:
    order = await session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    service = CheckoutOrchestrationService(session)
    orchestration = await service.get_or_create(order_id=order.id, user_id=order.user_id)
    await session.commit()
    await session.refresh(orchestration)
    await session.refresh(orchestration, attribute_names=["events"])
    return _serialize_orchestration(orchestration)


@router.post("/orchestrations/{order_id}/events", response_model=CheckoutOrchestrationResponse)
async def post_checkout_event(
    order_id: UUID,
    payload: CheckoutEventPayload,
    session: AsyncSession = Depends(get_session),
) -> CheckoutOrchestrationResponse:
    order = await session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    service = CheckoutOrchestrationService(session)
    orchestration = await service.get_or_create(order_id=order.id, user_id=order.user_id)
    update = StageUpdate(
        stage=payload.stage,
        status=payload.status,
        note=payload.note,
        payload=payload.payload,
        next_action_at=payload.next_action_at,
        metadata_patch=payload.metadata_patch,
    )
    await service.apply_update(orchestration, update)
    await session.commit()
    await session.refresh(orchestration)
    await session.refresh(orchestration, attribute_names=["events"])
    return _serialize_orchestration(orchestration)
