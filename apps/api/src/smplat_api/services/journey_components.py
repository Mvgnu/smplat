from __future__ import annotations

from uuid import UUID, uuid4
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.product import JourneyComponent
from smplat_api.schemas.product import JourneyComponentCreate, JourneyComponentUpdate


class JourneyComponentService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_components(self) -> list[JourneyComponent]:
        stmt = select(JourneyComponent).order_by(JourneyComponent.created_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_component_by_id(self, component_id: UUID) -> JourneyComponent | None:
        return await self._session.get(JourneyComponent, component_id)

    async def create_component(self, payload: JourneyComponentCreate) -> JourneyComponent:
        await self._ensure_unique_key(payload.key)
        component = JourneyComponent(id=uuid4())
        self._session.add(component)
        self._apply_payload(component, payload, partial=False)
        await self._session.commit()
        await self._session.refresh(component)
        return component

    async def update_component(
        self,
        component: JourneyComponent,
        payload: JourneyComponentUpdate,
    ) -> JourneyComponent:
        if payload.key and payload.key != component.key:
            await self._ensure_unique_key(payload.key, exclude_id=component.id)
        self._apply_payload(component, payload, partial=True)
        await self._session.commit()
        await self._session.refresh(component)
        return component

    async def delete_component(self, component: JourneyComponent) -> None:
        await self._session.delete(component)
        await self._session.commit()

    async def _ensure_unique_key(self, key: str, *, exclude_id: UUID | None = None) -> None:
        stmt = select(JourneyComponent).where(JourneyComponent.key == key)
        result = await self._session.execute(stmt)
        existing = result.scalars().first()
        if existing and (exclude_id is None or existing.id != exclude_id):
            raise ValueError("Journey component key already exists")

    def _apply_payload(
        self,
        component: JourneyComponent,
        payload: JourneyComponentCreate | JourneyComponentUpdate,
        *,
        partial: bool,
    ) -> None:
        provided_fields = payload.model_fields_set if partial else None

        def _should_set(field: str) -> bool:
            return not partial or (provided_fields is not None and field in provided_fields)

        key_value = getattr(payload, "key", None)
        if _should_set("key") and key_value is not None:
            component.key = key_value
        name_value = getattr(payload, "name", None)
        if _should_set("name") and name_value is not None:
            component.name = name_value
        if _should_set("description"):
            component.description = getattr(payload, "description", None)
        if _should_set("triggers"):
            component.triggers = self._serialize_sequence(getattr(payload, "triggers", []))
        script_slug = getattr(payload, "script_slug", None)
        if _should_set("script_slug") and script_slug is not None:
            component.script_slug = script_slug
        if _should_set("script_version"):
            component.script_version = getattr(payload, "script_version", None)
        if _should_set("script_runtime"):
            component.script_runtime = getattr(payload, "script_runtime", None)
        if _should_set("script_entrypoint"):
            component.script_entrypoint = getattr(payload, "script_entrypoint", None)
        if _should_set("input_schema"):
            component.input_schema = self._serialize_model(getattr(payload, "input_schema", None))
        if _should_set("output_schema"):
            component.output_schema = self._serialize_model(getattr(payload, "output_schema", None))
        if _should_set("provider_dependencies"):
            component.provider_dependencies = self._serialize_sequence(
                getattr(payload, "provider_dependencies", []) or []
            )
        if _should_set("timeout_seconds"):
            component.timeout_seconds = getattr(payload, "timeout_seconds", None)
        if _should_set("retry_policy"):
            component.retry_policy = self._serialize_model(getattr(payload, "retry_policy", None))
        if _should_set("telemetry_labels"):
            component.telemetry_labels = getattr(payload, "telemetry_labels", None)
        if _should_set("tags"):
            component.tags = list(getattr(payload, "tags", []) or [])
        if _should_set("metadata_json"):
            component.metadata_json = getattr(payload, "metadata_json", None)

    @staticmethod
    def _serialize_sequence(values: list[Any] | None) -> list[Any]:
        items = values or []
        return [
            item.model_dump(by_alias=True, exclude_none=True) if hasattr(item, "model_dump") else item
            for item in items
        ]

    @staticmethod
    def _serialize_model(value: Any | None) -> Any | None:
        if value is None:
            return None
        if hasattr(value, "model_dump"):
            return value.model_dump(by_alias=True, exclude_none=True)
        return value
