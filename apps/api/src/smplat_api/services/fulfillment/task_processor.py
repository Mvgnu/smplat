"""Background processor for fulfillment tasks."""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Awaitable, Callable
from uuid import UUID

from copy import deepcopy
import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import (
    FulfillmentTask,
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)
from smplat_api.models.order import OrderItem
from smplat_api.models.order import Order
from smplat_api.models.product import Product
from smplat_api.observability.fulfillment import get_fulfillment_store
from .fulfillment_service import FulfillmentService


SessionFactory = Callable[[], Awaitable[AsyncSession]] | Callable[[], AsyncSession]

# Persist the last loop error across processor instances for observability/tests
_LAST_LOOP_ERROR_MESSAGE: str | None = None
_LAST_LOOP_ERROR_AT: datetime | None = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


_TEMPLATE_PATTERN = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")
_SINGLE_TEMPLATE_PATTERN = re.compile(r"^\s*\{\{\s*([^}]+?)\s*\}\}\s*$")


@dataclass
class TaskProcessorMetrics:
    """Simple in-memory metrics for monitoring task processing."""

    tasks_processed: int = 0
    tasks_failed: int = 0
    tasks_retried: int = 0
    tasks_dead_lettered: int = 0
    loop_errors: int = 0
    last_run_started_at: datetime | None = None
    last_run_finished_at: datetime | None = None
    last_run_duration_seconds: float | None = None
    last_error: str | None = None
    last_error_at: datetime | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "tasks_processed": self.tasks_processed,
            "tasks_failed": self.tasks_failed,
            "tasks_retried": self.tasks_retried,
            "tasks_dead_lettered": self.tasks_dead_lettered,
            "loop_errors": self.loop_errors,
            "last_run_started_at": self.last_run_started_at.isoformat() if self.last_run_started_at else None,
            "last_run_finished_at": self.last_run_finished_at.isoformat() if self.last_run_finished_at else None,
            "last_run_duration_seconds": self.last_run_duration_seconds,
            "last_error": self.last_error,
            "last_error_at": self.last_error_at.isoformat() if self.last_error_at else None,
        }


class TaskProcessor:
    """Background worker that polls and processes fulfillment tasks."""

    def __init__(
        self,
        session_factory: SessionFactory,
        poll_interval_seconds: int = 30,
        batch_size: int = 25,
    ) -> None:
        self._session_factory = session_factory
        self._poll_interval = poll_interval_seconds
        self._batch_size = batch_size
        self._running = False
        self._metrics = TaskProcessorMetrics()
        self._observability = get_fulfillment_store()
        # Seed metrics with last global loop error if present
        if _LAST_LOOP_ERROR_MESSAGE is not None:
            self._metrics.last_error = _LAST_LOOP_ERROR_MESSAGE
            self._metrics.last_error_at = _LAST_LOOP_ERROR_AT

    @property
    def metrics(self) -> TaskProcessorMetrics:
        return self._metrics

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def poll_interval(self) -> int:
        return self._poll_interval

    @property
    def batch_size(self) -> int:
        return self._batch_size

    async def start(self) -> None:
        """Start the processor loop until `stop` is called."""
        if self._running:
            return

        logger.info("Starting fulfillment task processor", poll_interval=self._poll_interval)
        self._running = True

        try:
            while self._running:
                try:
                    await self.run_once()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover - defensive logging
                    self._metrics.loop_errors += 1
                    self._metrics.last_error = str(exc)
                    self._metrics.last_error_at = _utcnow()
                    # update global last error for new instances
                    global _LAST_LOOP_ERROR_MESSAGE, _LAST_LOOP_ERROR_AT
                    _LAST_LOOP_ERROR_MESSAGE = self._metrics.last_error
                    _LAST_LOOP_ERROR_AT = self._metrics.last_error_at
                    logger.exception("Fulfillment processor iteration failed")

                if not self._running:
                    break

                await asyncio.sleep(self._poll_interval)
        finally:
            self._running = False
            logger.info("Fulfillment task processor stopped")

    def stop(self) -> None:
        """Signal the processor loop to stop after the current iteration."""
        self._running = False

    async def run_once(self) -> None:
        """Process a single batch of pending tasks."""
        start_time = _utcnow()
        self._metrics.last_run_started_at = start_time
        session = await self._acquire_session()
        try:
            service = FulfillmentService(session)
            tasks = await service.get_pending_tasks(limit=self._batch_size)

            if not tasks:
                logger.debug("No pending fulfillment tasks found")
                return

            logger.info("Processing fulfillment tasks", count=len(tasks))

            for task in tasks:
                await self._process_single_task(service, task)
        except Exception as exc:
            self._metrics.last_error = str(exc)
            self._metrics.last_error_at = _utcnow()
            raise
        finally:
            await session.close()
            finished = _utcnow()
            self._metrics.last_run_finished_at = finished
            self._metrics.last_run_duration_seconds = (finished - start_time).total_seconds()

    async def _process_single_task(self, service: FulfillmentService, task: FulfillmentTask) -> None:
        """Process an individual fulfillment task."""
        await service.update_task_status(task.id, FulfillmentTaskStatusEnum.IN_PROGRESS)

        try:
            result = await self._execute_task(service, task)
            await service.update_task_status(
                task.id,
                FulfillmentTaskStatusEnum.COMPLETED,
                result_data=result,
            )
            self._metrics.tasks_processed += 1
            self._observability.record_processed(task.task_type.value)

            logger.info(
                "Fulfillment task completed",
                task_id=str(task.id),
                task_type=task.task_type.value,
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            self._metrics.tasks_failed += 1
            self._metrics.last_error = str(exc)
            self._metrics.last_error_at = _utcnow()
            self._observability.record_failure(task.task_type.value, str(exc))
            should_retry, retry_delay = await self._handle_task_failure(service, task, exc)
            if should_retry:
                self._metrics.tasks_retried += 1
                self._observability.record_retry(
                    task.task_type.value,
                    task.scheduled_at,
                    retry_delay,
                )
                logger.warning(
                    "Fulfillment task failure scheduled for retry",
                    task_id=str(task.id),
                    task_type=task.task_type.value,
                    retry_count=task.retry_count,
                    max_retries=task.max_retries,
                    next_run_at=task.scheduled_at.isoformat() if task.scheduled_at else None,
                )
            else:
                self._metrics.tasks_dead_lettered += 1
                self._observability.record_dead_letter(task.task_type.value)
                logger.error(
                    "Fulfillment task failed after exhausting retries",
                    task_id=str(task.id),
                    task_type=task.task_type.value,
                    retry_count=task.retry_count,
                    max_retries=task.max_retries,
                    error=str(exc),
                )

    async def _execute_task(self, service: FulfillmentService, task: FulfillmentTask) -> dict[str, Any]:
        """Execute business logic for a task type."""
        payload = task.payload or {}

        if payload.get("execution"):
            return await self._execute_configured_task(service, task, payload)

        if task.task_type == FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION:
            account_id = payload.get("instagram_account_id")
            if account_id:
                await service.instagram_service.update_account_analytics(UUID(account_id))
            return {"status": "analytics_collected", "account_id": account_id}

        if task.task_type == FulfillmentTaskTypeEnum.INSTAGRAM_SETUP:
            username = payload.get("username")
            profile_id = payload.get("customer_profile_id")
            if username and profile_id:
                await service.instagram_service.verify_instagram_account(username, UUID(profile_id))
            return {"status": "instagram_setup", "username": username}

        if task.task_type == FulfillmentTaskTypeEnum.FOLLOWER_GROWTH:
            return {"status": "campaign_started", "details": payload}

        if task.task_type == FulfillmentTaskTypeEnum.ENGAGEMENT_BOOST:
            return {"status": "engagement_actions_queued", "details": payload}

        if task.task_type == FulfillmentTaskTypeEnum.CONTENT_PROMOTION:
            return {"status": "promotion_scheduled", "details": payload}

        if task.task_type == FulfillmentTaskTypeEnum.CAMPAIGN_OPTIMIZATION:
            return {"status": "campaign_optimized", "details": payload}

        # Fallback for unspecified task types
        logger.warning("Unhandled fulfillment task type", task_type=task.task_type.value)
        return {"status": "unhandled", "task_type": task.task_type.value}

    async def _execute_configured_task(
        self,
        service: FulfillmentService,
        task: FulfillmentTask,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a task backed by product configuration."""
        execution_config = payload.get("execution") or {}
        environment_keys = execution_config.get("environment_keys")
        context_snapshot = payload.get("context")
        context = await self._build_execution_context(service, task, context_snapshot, environment_keys)

        try:
            rendered_execution = self._render_template_structure(execution_config, context)
            rendered_payload = None
            if payload.get("raw_payload") is not None:
                rendered_payload = self._render_template_structure(payload["raw_payload"], context)
        except Exception as exc:
            logger.exception(
                "Failed to render fulfillment task template",
                task_id=str(task.id),
                task_type=task.task_type.value,
            )
            raise RuntimeError(f"Failed to render configured task template: {exc}") from exc

        execution_kind = str(rendered_execution.get("kind") or "http").lower()

        if execution_kind == "http":
            result = await self._perform_http_execution(rendered_execution)
            if rendered_payload is not None:
                result["payload_snapshot"] = rendered_payload
            result["execution_kind"] = "http"
            return result

        raise RuntimeError(f"Unsupported execution kind '{execution_kind}' for fulfillment task")

    async def _build_execution_context(
        self,
        service: FulfillmentService,
        task: FulfillmentTask,
        snapshot: dict[str, Any] | None,
        environment_keys: list[str] | None,
    ) -> dict[str, Any]:
        """Build runtime context for templating execution configuration."""
        context = deepcopy(snapshot) if isinstance(snapshot, dict) else {}

        order_item = task.order_item
        if order_item is None:
            order_item = await service.db.get(OrderItem, task.order_item_id)

        if order_item:
            order_data = order_item.order
            if order_data is None and getattr(order_item, "order_id", None):
                order_data = await service.db.get(Order, order_item.order_id)
            context["item"] = service._serialize_order_item(order_item)
            if order_data:
                context["order"] = service._serialize_order(order_data)

            product_id = getattr(order_item, "product_id", None)
            if product_id:
                product = await service.db.get(Product, product_id)
                if product:
                    context["product"] = service._serialize_product(product)

        context["task"] = {
            "id": str(task.id),
            "type": task.task_type.value,
            "status": task.status.value,
            "retry_count": task.retry_count or 0,
            "max_retries": task.max_retries or 0,
        }
        context["env"] = self._environment_context(environment_keys)

        return context

    def _render_template_structure(self, structure: Any, context: dict[str, Any]) -> Any:
        """Render templated values within a nested structure."""
        if isinstance(structure, dict):
            return {key: self._render_template_structure(value, context) for key, value in structure.items()}
        if isinstance(structure, list):
            return [self._render_template_structure(value, context) for value in structure]
        if isinstance(structure, str):
            if "{{" not in structure:
                return structure

            single_match = _SINGLE_TEMPLATE_PATTERN.match(structure)
            if single_match:
                expression = single_match.group(1).strip()
                value = self._resolve_context_path(context, expression)
                return value

            rendered = self._render_template_string(structure, context)
            return self._coerce_scalar(rendered, structure)
        return structure

    def _render_template_string(self, template: str, context: dict[str, Any]) -> str:
        """Render interpolations for inline template strings."""

        def replacer(match: re.Match[str]) -> str:
            expression = match.group(1).strip()
            value = self._resolve_context_path(context, expression)
            if value is None:
                return ""
            if isinstance(value, (dict, list)):
                return json.dumps(value)
            return str(value)

        return _TEMPLATE_PATTERN.sub(replacer, template)

    def _resolve_context_path(self, context: dict[str, Any], expression: str) -> Any:
        """Resolve dotted template expressions into context values."""
        if not expression:
            raise KeyError("Empty template expression")

        if "|" in expression:
            raise KeyError(f"Unsupported template filter syntax in '{expression}'")

        current: Any = context
        for part in expression.split("."):
            key = part.strip()
            if key == "":
                raise KeyError(f"Invalid empty segment in template expression '{expression}'")

            if isinstance(current, dict):
                if key not in current:
                    raise KeyError(f"Missing key '{key}' in template context")
                current = current[key]
            elif isinstance(current, (list, tuple)):
                if not key.isdigit():
                    raise KeyError(f"List index '{key}' must be numeric in template expression '{expression}'")
                index = int(key)
                if index >= len(current):
                    raise KeyError(f"Index {index} out of range for template expression '{expression}'")
                current = current[index]
            else:
                if not hasattr(current, key):
                    raise KeyError(f"Attribute '{key}' missing on template context object")
                current = getattr(current, key)

        return current

    @staticmethod
    def _coerce_scalar(rendered: str, original: str) -> Any:
        """Attempt to coerce rendered scalar values into native Python types."""
        if not isinstance(rendered, str):
            return rendered

        trimmed = rendered.strip()
        if not trimmed:
            return ""

        if trimmed.lower() in {"null", "none"}:
            return None
        if trimmed.lower() == "true":
            return True
        if trimmed.lower() == "false":
            return False

        # Only attempt numeric parsing if the original value was a pure template
        if original.strip().startswith("{{") and original.strip().endswith("}}"):
            try:
                return int(trimmed)
            except ValueError:
                try:
                    return float(trimmed)
                except ValueError:
                    pass

        return rendered

    async def _perform_http_execution(self, execution: dict[str, Any]) -> dict[str, Any]:
        """Execute an HTTP request based on execution configuration."""
        method = str(execution.get("method") or "POST").upper()
        url = execution.get("url")
        if not url:
            raise RuntimeError("HTTP execution is missing a URL")

        headers = execution.get("headers")
        if isinstance(headers, dict):
            headers = {str(key): str(value) for key, value in headers.items() if value is not None}
        else:
            headers = None

        params = execution.get("query") or execution.get("params")
        if isinstance(params, dict):
            params = {str(key): value for key, value in params.items() if value is not None}
        else:
            params = None

        body = execution.get("body")
        json_payload: Any | None = None
        content: str | bytes | None = None
        data: Any | None = None

        if isinstance(body, (dict, list)):
            json_payload = body
        elif isinstance(body, (str, bytes)):
            content = body
        elif body is not None:
            data = body

        timeout_value = execution.get("timeout_seconds")
        try:
            timeout_seconds = float(timeout_value) if timeout_value is not None else 30.0
        except (TypeError, ValueError):
            timeout_seconds = 30.0

        start = monotonic()
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(
                method,
                str(url),
                headers=headers,
                params=params,
                json=json_payload,
                content=content,
                data=data,
            )
        duration_ms = int((monotonic() - start) * 1000)

        status_code = response.status_code
        is_success = self._is_success_status(status_code, execution)

        if not is_success:
            preview = self._safe_response_preview(response)
            raise RuntimeError(f"HTTP request failed with status {status_code}: {preview}")

        try:
            response_data = response.json()
        except ValueError:
            response_data = self._safe_response_preview(response)

        return {
            "status": "http_request_completed",
            "status_code": status_code,
            "duration_ms": duration_ms,
            "response": response_data,
        }

    @staticmethod
    def _environment_context(keys: list[str] | None) -> dict[str, Any]:
        if not keys:
            return {key: value for key, value in os.environ.items()}
        return {key: os.environ.get(key) for key in keys}

    @staticmethod
    def _is_success_status(status_code: int, execution: dict[str, Any]) -> bool:
        success_statuses = execution.get("success_statuses")
        if isinstance(success_statuses, list) and success_statuses:
            normalized = {int(code) for code in success_statuses if isinstance(code, (int, float))}
            if normalized:
                return status_code in normalized

        lower_bound = execution.get("success_status_min")
        upper_bound = execution.get("success_status_max")
        try:
            lower = int(lower_bound) if lower_bound is not None else None
        except (TypeError, ValueError):
            lower = None
        try:
            upper = int(upper_bound) if upper_bound is not None else None
        except (TypeError, ValueError):
            upper = None

        if lower is not None or upper is not None:
            lower = 200 if lower is None else lower
            upper = 299 if upper is None else upper
            return lower <= status_code <= upper

        return 200 <= status_code < 300

    @staticmethod
    def _safe_response_preview(response: httpx.Response) -> str:
        text = response.text
        if len(text) > 512:
            return f"{text[:512]}…"
        return text

    def _compute_retry_delay(self, retry_count: int) -> int:
        """Compute delay before the next retry using exponential backoff."""
        base_delay_seconds = 60
        max_delay_seconds = 1800
        return min(max_delay_seconds, base_delay_seconds * (2 ** retry_count))

    async def _handle_task_failure(
        self,
        service: FulfillmentService,
        task: FulfillmentTask,
        exc: Exception,
    ) -> tuple[bool, int]:
        """Handle task failure by scheduling retries or marking the task as failed."""
        current_retries = task.retry_count or 0
        max_retries = task.max_retries or 0

        if current_retries >= max_retries:
            await service.update_task_status(
                task.id,
                FulfillmentTaskStatusEnum.FAILED,
                error_message=str(exc),
                result_data={
                    "dead_letter": True,
                    "retry_count": current_retries,
                    "max_retries": max_retries,
                },
            )
            return False, 0

        delay_seconds = self._compute_retry_delay(current_retries)
        await service.schedule_retry(
            task=task,
            delay_seconds=delay_seconds,
            error_message=str(exc),
        )
        return True, delay_seconds

    async def _acquire_session(self) -> AsyncSession:
        """Create or await an async session from the configured factory."""
        session_or_awaitable = self._session_factory()
        if asyncio.iscoroutine(session_or_awaitable):
            return await session_or_awaitable
        return session_or_awaitable

    def health_snapshot(self) -> dict[str, Any]:
        """Return a serializable snapshot of processor health."""
        return {
            "running": self.is_running,
            "poll_interval_seconds": self._poll_interval,
            "batch_size": self._batch_size,
            "metrics": self._metrics.snapshot(),
        }
