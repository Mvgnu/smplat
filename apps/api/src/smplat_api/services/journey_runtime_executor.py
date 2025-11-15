"""Helpers that resolve journey component bindings and call script runners."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from time import perf_counter
from typing import Any, Iterable, Mapping, Protocol
from uuid import UUID

import httpx
from fastapi.encoders import jsonable_encoder
from loguru import logger

from smplat_api.core.settings import settings
from smplat_api.models import JourneyComponent, Product, ProductJourneyComponent
from smplat_api.models.journey_runtime import JourneyComponentRun


@dataclass(slots=True)
class JourneyScriptRequest:
    run_id: str
    component_id: str
    component_key: str
    script_slug: str
    script_version: str | None
    script_runtime: str | None
    script_entrypoint: str | None
    trigger: Mapping[str, Any] | None
    bindings: dict[str, Any]
    binding_snapshot: list[dict[str, Any]]
    input_payload: Mapping[str, Any]
    metadata: Mapping[str, Any]
    context: Mapping[str, Any]
    channel: str | None
    product: Mapping[str, Any] | None
    product_component: Mapping[str, Any] | None


@dataclass(slots=True)
class JourneyScriptResponse:
    success: bool
    output: Any | None = None
    error: str | None = None
    telemetry: Mapping[str, Any] | None = None


@dataclass(slots=True)
class JourneyRuntimeExecutionResult:
    success: bool
    result: Any | None = None
    error: str | None = None
    telemetry: Mapping[str, Any] | None = None


class JourneyScriptRunner(Protocol):
    async def run(self, request: JourneyScriptRequest) -> JourneyScriptResponse: ...


class EchoJourneyScriptRunner:
    """Default runner that simply echoes the payload for development usage."""

    async def run(self, request: JourneyScriptRequest) -> JourneyScriptResponse:  # pragma: no cover - trivial
        return JourneyScriptResponse(
            success=True,
            output={
                "componentId": request.component_id,
                "componentKey": request.component_key,
                "script": {
                    "slug": request.script_slug,
                    "version": request.script_version,
                    "runtime": request.script_runtime,
                    "entrypoint": request.script_entrypoint,
                },
                "bindings": request.bindings,
                "input": request.input_payload,
                "metadata": request.metadata,
                "context": request.context,
                "channel": request.channel,
                "trigger": request.trigger,
            },
            telemetry={"runner": "echo", "latencyMs": 0},
        )


class HttpJourneyScriptRunner:
    """HTTP client that forwards script requests to an external runner service."""

    def __init__(self, endpoint_url: str, *, api_key: str | None = None, timeout_seconds: float = 15.0) -> None:
        self._endpoint_url = endpoint_url
        self._api_key = api_key
        self._timeout = timeout_seconds

    async def run(self, request: JourneyScriptRequest) -> JourneyScriptResponse:
        payload = jsonable_encoder(asdict(request))
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        start = perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(self._endpoint_url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            latency_ms = int((perf_counter() - start) * 1000)
            return JourneyScriptResponse(
                success=False,
                error=f"Runner request failed: {exc}",
                telemetry={"runner": "http", "latencyMs": latency_ms},
            )
        latency_ms = int((perf_counter() - start) * 1000)
        telemetry: dict[str, Any] = {"runner": "http", "latencyMs": latency_ms, "statusCode": response.status_code}
        try:
            body = response.json()
        except ValueError:
            return JourneyScriptResponse(
                success=False,
                error="Runner response was not valid JSON",
                telemetry=telemetry,
            )
        runner_telemetry = body.get("telemetry")
        if isinstance(runner_telemetry, Mapping):
            telemetry.update({key: value for key, value in runner_telemetry.items() if value is not None})
        success: bool = bool(body.get("success")) if "success" in body else response.is_success
        output_payload = body.get("output")
        error_message = body.get("error")
        return JourneyScriptResponse(
            success=success,
            output=dict(output_payload) if isinstance(output_payload, Mapping) else output_payload,
            error=error_message,
            telemetry=telemetry,
        )


_DEFAULT_RUNNER: JourneyScriptRunner | None = None


def _get_configured_runner() -> JourneyScriptRunner:
    global _DEFAULT_RUNNER
    if _DEFAULT_RUNNER is not None:
        return _DEFAULT_RUNNER
    if settings.journey_runtime_runner_url:
        _DEFAULT_RUNNER = HttpJourneyScriptRunner(
            settings.journey_runtime_runner_url,
            api_key=settings.journey_runtime_runner_api_key,
            timeout_seconds=settings.journey_runtime_runner_timeout_seconds,
        )
    else:
        _DEFAULT_RUNNER = EchoJourneyScriptRunner()
    return _DEFAULT_RUNNER


class JourneyRuntimeExecutor:
    """Resolve bindings and dispatch a journey component script."""

    def __init__(self, runner: JourneyScriptRunner | None = None) -> None:
        self._runner = runner or _get_configured_runner()

    async def execute(self, run: JourneyComponentRun) -> JourneyRuntimeExecutionResult:
        component = run.component
        if component is None:
            return JourneyRuntimeExecutionResult(success=False, error="Journey component definition missing")

        product = run.product or (run.product_component.product if run.product_component else None)
        binding_snapshot = self._normalize_binding_snapshot(run.binding_snapshot)
        resolved_bindings, missing_required = self._resolve_bindings(
            binding_snapshot,
            component=component,
            product=product,
            product_component=run.product_component,
            run_payload=run.input_payload or {},
            run_context=run.context or {},
            run_metadata=run.metadata_json or {},
            trigger=run.trigger or {},
        )
        if missing_required:
            missing_keys = ", ".join(sorted(missing_required))
            logger.warning(
                "Journey runtime missing required bindings",
                run_id=str(run.id),
                missing=missing_keys,
            )
            return JourneyRuntimeExecutionResult(
                success=False,
                error=f"Missing required bindings: {missing_keys}",
                telemetry={
                    "runner": self._runner_label(),
                    "missingBindings": sorted(missing_required),
                    "bindingsCount": len(resolved_bindings),
                },
            )

        request = JourneyScriptRequest(
            run_id=str(run.id),
            component_id=str(component.id),
            component_key=component.key,
            script_slug=component.script_slug,
            script_version=component.script_version,
            script_runtime=component.script_runtime,
            script_entrypoint=component.script_entrypoint,
            trigger=self._as_mapping(run.trigger),
            bindings=resolved_bindings,
            binding_snapshot=binding_snapshot,
            input_payload=self._as_mapping(run.input_payload),
            metadata=self._as_mapping(run.metadata_json),
            context=self._as_mapping(run.context),
            channel=run.channel,
            product=self._build_entity_snapshot(product),
            product_component=self._build_entity_snapshot(run.product_component),
        )

        try:
            response = await self._runner.run(request)
        except Exception as exc:  # pragma: no cover - runner implementations handle their own errors
            logger.exception("Journey script runner crashed", run_id=request.run_id)
            return JourneyRuntimeExecutionResult(
                success=False,
                error=str(exc),
                telemetry={"runner": self._runner_label(), "errorPreview": str(exc)[:256]},
            )

        telemetry = self._build_execution_telemetry(response, resolved_bindings=resolved_bindings)
        if response.success:
            return JourneyRuntimeExecutionResult(success=True, result=response.output, telemetry=telemetry)
        return JourneyRuntimeExecutionResult(
            success=False,
            error=response.error or "Journey script failed",
            telemetry=telemetry,
        )

    def _build_execution_telemetry(
        self,
        response: JourneyScriptResponse,
        *,
        resolved_bindings: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        telemetry: dict[str, Any] = {}
        if isinstance(response.telemetry, Mapping):
            telemetry.update({key: value for key, value in response.telemetry.items() if value is not None})
        telemetry.setdefault("runner", self._runner_label())
        telemetry["bindingsCount"] = len(resolved_bindings)
        if response.success:
            preview = self._build_output_preview(response.output)
            if preview:
                telemetry.setdefault("outputPreview", preview)
        elif response.error:
            telemetry.setdefault("errorPreview", response.error[:256])
        return telemetry or None

    def _build_output_preview(self, payload: Any | None) -> str | None:
        if payload is None:
            return None
        try:
            encoded = json.dumps(payload, default=self._coerce_value)
        except (TypeError, ValueError):
            encoded = str(payload)
        if len(encoded) > 512:
            return f"{encoded[:512]}..."
        return encoded

    def _runner_label(self) -> str:
        name = type(self._runner).__name__
        simplified = name.replace("JourneyScriptRunner", "")
        return simplified.lower() or name.lower()

    def _resolve_bindings(
        self,
        snapshot: list[dict[str, Any]],
        *,
        component: JourneyComponent,
        product: Product | None,
        product_component: ProductJourneyComponent | None,
        run_payload: Mapping[str, Any],
        run_context: Mapping[str, Any],
        run_metadata: Mapping[str, Any],
        trigger: Mapping[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        resolved: dict[str, Any] = {}
        missing_required: list[str] = []
        product_sources = {
            "product": self._build_entity_snapshot(product),
            "productComponent": self._build_entity_snapshot(product_component),
            "component": self._build_entity_snapshot(component),
        }
        runtime_sources = {
            "input": self._as_mapping(run_payload),
            "context": self._as_mapping(run_context),
            "metadata": self._as_mapping(run_metadata),
            "trigger": self._as_mapping(trigger),
        }

        for binding in snapshot:
            key = self._read_binding_field(binding, "inputKey")
            if not key:
                continue
            kind = (binding.get("kind") or "").lower()
            required = bool(binding.get("required"))
            value: Any = None
            if kind == "static":
                value = binding.get("value")
            elif kind == "product_field":
                path = self._read_binding_field(binding, "path")
                value = self._extract_from_sources(product_sources, path, default_root="product")
            elif kind == "runtime":
                source = self._read_binding_field(binding, "source") or self._read_binding_field(binding, "path")
                value = self._extract_from_sources(runtime_sources, source, default_root="input")
            else:
                logger.debug("Unsupported journey binding kind", kind=kind, binding=binding, run_id=str(binding.get("id", "")))

            if value is None and required and kind != "static":
                missing_required.append(key)
                continue
            resolved[key] = value

        return resolved, missing_required

    def _extract_from_sources(
        self,
        sources: Mapping[str, Any],
        path: str | None,
        *,
        default_root: str,
    ) -> Any:
        if not path:
            return None
        tokens = self._split_path(path)
        if not tokens:
            return None
        root_key = tokens[0]
        remaining = tokens[1:]
        dataset = sources.get(root_key)
        if dataset is None:
            dataset = sources.get(default_root)
            remaining = tokens
        return self._walk_tokens(dataset, remaining)

    def _walk_tokens(self, data: Any, tokens: Iterable[str]) -> Any:
        current = data
        for token in tokens:
            if current is None:
                return None
            if isinstance(current, Mapping):
                current = current.get(token)
            elif isinstance(current, (list, tuple)):
                try:
                    index = int(token)
                except ValueError:
                    return None
                if index < 0 or index >= len(current):
                    return None
                current = current[index]
            else:
                return None
        return current

    def _split_path(self, path: str) -> list[str]:
        normalized = path.replace("[", ".").replace("]", ".")
        tokens = [token for token in normalized.split(".") if token]
        return tokens

    def _build_entity_snapshot(
        self,
        entity: Product | ProductJourneyComponent | JourneyComponent | None,
    ) -> dict[str, Any] | None:
        if entity is None:
            return None
        snapshot: dict[str, Any] = {}
        for column in entity.__table__.columns:  # type: ignore[attr-defined]
            value = getattr(entity, column.key)
            snapshot[column.key] = self._coerce_value(value)
        metadata_value = getattr(entity, "metadata_json", None)
        if metadata_value is not None:
            snapshot["metadata"] = metadata_value
        if isinstance(entity, ProductJourneyComponent):
            snapshot["bindings"] = list(entity.bindings or [])
            snapshot["channel_eligibility"] = list(entity.channel_eligibility or [])
        if isinstance(entity, JourneyComponent):
            snapshot["triggers"] = list(entity.triggers or [])
            snapshot["provider_dependencies"] = list(entity.provider_dependencies or [])
            snapshot["retry_policy"] = self._as_mapping(entity.retry_policy)
        return snapshot

    def _coerce_value(self, value: Any) -> Any:
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    def _as_mapping(self, value: Any | None) -> dict[str, Any]:
        if isinstance(value, Mapping):
            return dict(value)
        return {}

    def _read_binding_field(self, binding: Mapping[str, Any], field: str) -> str | None:
        camel = field[0].lower() + field[1:]
        snake = "".join(["_" + ch.lower() if ch.isupper() else ch for ch in field]).lstrip("_")
        for key in {field, camel, snake}:
            value = binding.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _normalize_binding_snapshot(self, snapshot: Any) -> list[dict[str, Any]]:
        if isinstance(snapshot, list):
            normalized: list[dict[str, Any]] = []
            for entry in snapshot:
                if isinstance(entry, Mapping):
                    normalized.append(dict(entry))
            return normalized
        return []


__all__ = [
    "JourneyRuntimeExecutor",
    "JourneyRuntimeExecutionResult",
    "JourneyScriptRequest",
    "JourneyScriptResponse",
    "JourneyScriptRunner",
    "EchoJourneyScriptRunner",
    "HttpJourneyScriptRunner",
]
