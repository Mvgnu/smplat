from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, List
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from smplat_api.app import create_app
from smplat_api.observability.fulfillment import get_fulfillment_store
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.fulfillment import FulfillmentTask
from smplat_api.models.order import Order, OrderItem, OrderSourceEnum, OrderStatusEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.services.fulfillment.fulfillment_service import FulfillmentService
from smplat_api.services.fulfillment.task_processor import TaskProcessor
from smplat_api.services.fulfillment.task_processor import (
    FulfillmentTaskStatusEnum,
    FulfillmentTaskTypeEnum,
)


class DummySession:
    async def close(self) -> None:
        self.closed = True


class FakeInstagramService:
    def __init__(self) -> None:
        self.analytics_updated: List[UUID] = []

    async def update_account_analytics(self, account_id: UUID) -> None:
        self.analytics_updated.append(account_id)

    async def verify_instagram_account(self, *_: Any) -> None:
        pass


class FakeFulfillmentService:
    instances: list["FakeFulfillmentService"] = []

    def __init__(self, session: DummySession) -> None:
        self.session = session
        self.instagram_service = FakeInstagramService()
        self.status_updates: list[tuple[UUID, FulfillmentTaskStatusEnum]] = []
        self.scheduled_retries: list[tuple[UUID, int]] = []
        FakeFulfillmentService.instances.append(self)

    async def get_pending_tasks(self, limit: int) -> list[Any]:
        account_id = uuid4()
        task = SimpleNamespace(
            id=uuid4(),
            task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
            payload={"instagram_account_id": str(account_id)},
            retry_count=0,
            max_retries=3,
            scheduled_at=datetime.utcnow() - timedelta(seconds=5),
        )
        return [task]

    async def update_task_status(
        self,
        task_id: UUID,
        status: FulfillmentTaskStatusEnum,
        result_data: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        self.status_updates.append((task_id, status))

    async def schedule_retry(
        self,
        task: Any,
        delay_seconds: int,
        error_message: str,
    ) -> None:
        task.retry_count = getattr(task, "retry_count", 0) + 1
        task.status = FulfillmentTaskStatusEnum.PENDING
        task.error_message = error_message
        task.scheduled_at = datetime.utcnow() + timedelta(seconds=delay_seconds)
        self.scheduled_retries.append((task.id, delay_seconds))


@pytest.mark.asyncio
async def test_task_processor_run_once(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeFulfillmentService.instances.clear()
    get_fulfillment_store().reset()
    monkeypatch.setattr(
        "smplat_api.services.fulfillment.task_processor.FulfillmentService",
        FakeFulfillmentService,
    )

    processor = TaskProcessor(lambda: DummySession())

    await processor.run_once()

    service = FakeFulfillmentService.instances[-1]

    assert processor.metrics.tasks_processed == 1
    assert processor.metrics.tasks_failed == 0
    assert processor.metrics.last_run_started_at is not None
    assert processor.metrics.last_run_finished_at is not None
    assert any(status == FulfillmentTaskStatusEnum.IN_PROGRESS for _, status in service.status_updates)
    assert any(status == FulfillmentTaskStatusEnum.COMPLETED for _, status in service.status_updates)
    assert len(service.instagram_service.analytics_updated) == 1


@pytest.mark.asyncio
async def test_task_processor_failure_dead_letters_when_retries_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeFulfillmentService.instances.clear()
    get_fulfillment_store().reset()

    class FailingService(FakeFulfillmentService):
        async def get_pending_tasks(self, limit: int) -> list[Any]:
            task = SimpleNamespace(
                id=uuid4(),
                task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
                payload={},
                retry_count=0,
                max_retries=0,
                scheduled_at=datetime.utcnow() - timedelta(seconds=5),
            )
            return [task]

    async def raise_error(self, service, task):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "smplat_api.services.fulfillment.task_processor.FulfillmentService",
        FailingService,
    )
    monkeypatch.setattr(TaskProcessor, "_execute_task", raise_error, raising=False)

    processor = TaskProcessor(lambda: DummySession())
    await processor.run_once()

    assert processor.metrics.tasks_processed == 0
    assert processor.metrics.tasks_failed == 1
    assert processor.metrics.tasks_retried == 0
    assert processor.metrics.tasks_dead_lettered == 1
    assert processor.metrics.last_error == "boom"

    service = FailingService.instances[-1]
    assert any(status == FulfillmentTaskStatusEnum.IN_PROGRESS for _, status in service.status_updates)
    assert any(status == FulfillmentTaskStatusEnum.FAILED for _, status in service.status_updates)
    assert service.scheduled_retries == []


@pytest.mark.asyncio
async def test_task_processor_schedules_retry_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeFulfillmentService.instances.clear()
    get_fulfillment_store().reset()

    class RetryingService(FakeFulfillmentService):
        async def get_pending_tasks(self, limit: int) -> list[Any]:
            task = SimpleNamespace(
                id=uuid4(),
                task_type=FulfillmentTaskTypeEnum.CONTENT_PROMOTION,
                payload={},
                retry_count=0,
                max_retries=2,
                scheduled_at=datetime.utcnow() - timedelta(seconds=5),
            )
            return [task]

    async def raise_error(self, service, task):  # type: ignore[no-untyped-def]
        raise RuntimeError("transient")

    monkeypatch.setattr(
        "smplat_api.services.fulfillment.task_processor.FulfillmentService",
        RetryingService,
    )
    monkeypatch.setattr(TaskProcessor, "_execute_task", raise_error, raising=False)

    processor = TaskProcessor(lambda: DummySession())
    await processor.run_once()

    assert processor.metrics.tasks_processed == 0
    assert processor.metrics.tasks_failed == 1
    assert processor.metrics.tasks_retried == 1
    assert processor.metrics.tasks_dead_lettered == 0
    assert processor.metrics.last_error == "transient"

    service = RetryingService.instances[-1]
    assert any(status == FulfillmentTaskStatusEnum.IN_PROGRESS for _, status in service.status_updates)
    assert not any(status == FulfillmentTaskStatusEnum.FAILED for _, status in service.status_updates)
    assert len(service.scheduled_retries) == 1


@pytest.mark.asyncio
async def test_task_processor_loop_handles_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    processor = TaskProcessor(lambda: DummySession(), poll_interval_seconds=0)

    async def failing_run_once() -> None:
        processor.stop()
        raise RuntimeError("loop fail")

    monkeypatch.setattr(processor, "run_once", failing_run_once)

    loop_task = asyncio.create_task(processor.start())
    await asyncio.sleep(0)  # allow task to execute
    await loop_task

    assert processor.metrics.loop_errors == 1


@pytest.mark.asyncio
async def test_execute_configured_http_task(session_factory, monkeypatch: pytest.MonkeyPatch) -> None:
    async with session_factory() as session:
        product = Product(
            slug="configurable-product",
            title="Configurable Product",
            description="Has fulfillment config",
            category="automation",
            base_price=Decimal("250.00"),
            currency=CurrencyEnum.EUR,
            status=ProductStatusEnum.ACTIVE,
            fulfillment_config={
                "tasks": [
                    {
                        "type": FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION.value,
                        "title": "Baseline HTTP sync",
                        "schedule_offset_minutes": 0,
                        "execution": {
                            "kind": "http",
                            "method": "POST",
                            "url": "{{ env.FULFILLMENT_BASE_URL }}/hooks/orders/{{ order.id }}",
                            "headers": {
                                "Authorization": "Bearer {{ env.FULFILLMENT_ANALYTICS_TOKEN }}",
                                "X-Order-Number": "{{ order.order_number }}",
                            },
                            "body": {
                                "orderId": "{{ order.id }}",
                                "productId": "{{ product.id }}",
                                "itemId": "{{ item.id }}",
                                "quantity": "{{ item.quantity }}",
                            },
                            "environment_keys": ["FULFILLMENT_BASE_URL", "FULFILLMENT_ANALYTICS_TOKEN"],
                            "success_statuses": [202],
                        },
                    }
                ]
            },
        )

        order = Order(
            order_number="SM300001",
            subtotal=Decimal("250.00"),
            tax=Decimal("0"),
            total=Decimal("250.00"),
            currency=CurrencyEnum.EUR,
            status=OrderStatusEnum.PENDING,
            source=OrderSourceEnum.CHECKOUT,
        )

        session.add(product)
        await session.flush()

        order_item = OrderItem(
            product_id=product.id,
            product_title=product.title,
            quantity=1,
            unit_price=Decimal("250.00"),
            total_price=Decimal("250.00"),
        )
        order.items.append(order_item)
        session.add(order)
        await session.commit()

        service = FulfillmentService(session)
        assert await service.process_order_fulfillment(order.id) is True

        task = (
            await session.execute(
                select(FulfillmentTask)
                .options(
                    selectinload(FulfillmentTask.order_item).selectinload(OrderItem.order)
                )
                .where(FulfillmentTask.order_item_id == order_item.id)
            )
        ).scalar_one()

        captured: dict[str, Any] = {}

        class FakeResponse:
            status_code = 202

            @staticmethod
            def json() -> dict[str, Any]:
                return {"status": "accepted"}

            @property
            def text(self) -> str:
                return '{"status": "accepted"}'

        async def fake_request(
            self,
            method: str,
            url: str,
            headers: dict[str, Any] | None = None,
            params: dict[str, Any] | None = None,
            json: Any | None = None,
            content: Any | None = None,
            data: Any | None = None,
        ) -> FakeResponse:
            captured["method"] = method
            captured["url"] = url
            captured["headers"] = headers or {}
            captured["json"] = json
            captured["params"] = params
            captured["content"] = content
            captured["data"] = data
            return FakeResponse()

        monkeypatch.setenv("FULFILLMENT_BASE_URL", "https://ops.example")
        monkeypatch.setenv("FULFILLMENT_ANALYTICS_TOKEN", "token-321")
        monkeypatch.setattr(AsyncClient, "request", fake_request, raising=False)

        processor = TaskProcessor(lambda: session)
        result = await processor._execute_task(service, task)

        assert result["status"] == "http_request_completed"
        assert result["status_code"] == 202
        assert captured["method"] == "POST"
        assert captured["url"] == f"https://ops.example/hooks/orders/{order.id}"
        assert captured["headers"]["Authorization"] == "Bearer token-321"
        assert captured["headers"]["X-Order-Number"] == order.order_number
        assert captured["json"]["orderId"] == str(order.id)
        assert captured["json"]["productId"] == str(product.id)
        assert result["execution_kind"] == "http"
        if "payload_snapshot" in result:
            assert isinstance(result["payload_snapshot"], dict)
    assert processor.metrics.last_error == "loop fail"
    assert processor.metrics.last_error_at is not None


@pytest.mark.asyncio
async def test_task_processor_health_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeFulfillmentService.instances.clear()
    get_fulfillment_store().reset()
    monkeypatch.setattr(
        "smplat_api.services.fulfillment.task_processor.FulfillmentService",
        FakeFulfillmentService,
    )

    processor = TaskProcessor(lambda: DummySession())
    await processor.run_once()
    snapshot = processor.health_snapshot()

    assert snapshot["running"] is False
    assert snapshot["poll_interval_seconds"] == processor.poll_interval
    assert snapshot["metrics"]["last_run_finished_at"] is not None


@pytest.mark.asyncio
async def test_fulfillment_metrics_endpoint() -> None:
    app = create_app()

    def dummy_session_factory():
        return DummySession()

    processor = TaskProcessor(dummy_session_factory)
    app.state.fulfillment_processor = processor

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/metrics")

    assert response.status_code == 200
    body = response.json()
    assert "tasks_processed" in body
    assert "last_run_started_at" in body
    assert body["tasks_processed"] == 0
    assert "tasks_retried" in body
    assert "tasks_dead_lettered" in body


@pytest.mark.asyncio
async def test_fulfillment_health_endpoint() -> None:
    app = create_app()

    def dummy_session_factory():
        return DummySession()

    processor = TaskProcessor(dummy_session_factory)
    app.state.fulfillment_processor = processor

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/health")

    assert response.status_code == 200
    body = response.json()
    assert body["running"] is False
    assert "poll_interval_seconds" in body
    assert "metrics" in body
@pytest.mark.asyncio
async def test_fulfillment_observability_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeFulfillmentService.instances.clear()
    store = get_fulfillment_store()
    store.reset()

    class SingleRunService(FakeFulfillmentService):
        async def get_pending_tasks(self, limit: int) -> list[Any]:
            task = SimpleNamespace(
                id=uuid4(),
                task_type=FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION,
                payload={"instagram_account_id": str(uuid4())},
                retry_count=0,
                max_retries=1,
                scheduled_at=datetime.utcnow() - timedelta(seconds=5),
            )
            return [task]

    monkeypatch.setattr(
        "smplat_api.services.fulfillment.task_processor.FulfillmentService",
        SingleRunService,
    )

    processor = TaskProcessor(lambda: DummySession())
    await processor.run_once()

    app = create_app()
    app.state.fulfillment_processor = processor

    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/v1/fulfillment/observability")

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["processed"] >= 1
    assert "processed" in body["per_task_type"]
    assert body["per_task_type"]["processed"]
