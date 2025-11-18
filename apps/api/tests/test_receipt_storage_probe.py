from __future__ import annotations

import pytest
from botocore.exceptions import ClientError

from smplat_api.core.settings import Settings
from smplat_api.models.receipt_storage_probe import ReceiptStorageProbeTelemetry
from smplat_api.services.orders.receipt_storage_probe import (
    ReceiptStorageProbeResult,
    ReceiptStorageProbeService,
)
from smplat_api.workers.receipt_storage_probe import ReceiptStorageProbeWorker


class StubS3Client:
    def __init__(self, *, fail_get: bool = False):
        self._objects: dict[str, bytes] = {}
        self._fail_get = fail_get

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str, ACL: str):
        self._objects[Key] = Body

    def get_object(self, *, Bucket: str, Key: str):
        if self._fail_get:
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
        if Key not in self._objects:
            raise ClientError({"Error": {"Code": "NotFound"}}, "GetObject")
        return {"Body": self._objects[Key]}

    def delete_object(self, *, Bucket: str, Key: str):
        self._objects.pop(Key, None)


@pytest.mark.asyncio
async def test_receipt_storage_probe_records_success(session_factory):
    async with session_factory() as session:
        settings = Settings(
            receipt_storage_bucket="unit-test-bucket",
            receipt_storage_public_base_url="https://example.test/receipts",
        )
        service = ReceiptStorageProbeService(
            session,
            settings=settings,
            s3_client_factory=lambda: StubS3Client(),
        )
        result = await service.run_probe()

    assert result.success is True
    assert result.sentinel_key is not None

    async with session_factory() as session_check:
        telemetry = await session_check.get(ReceiptStorageProbeTelemetry, "receipt_storage")
        assert telemetry is not None
        assert telemetry.last_success_at is not None
        assert telemetry.last_error_at is None
        assert telemetry.last_sentinel_key is not None
        assert telemetry.last_detail is not None


@pytest.mark.asyncio
async def test_receipt_storage_probe_records_failure(session_factory):
    async with session_factory() as session:
        settings = Settings(
            receipt_storage_bucket="unit-test-bucket",
            receipt_storage_public_base_url="https://example.test/receipts",
        )
        service = ReceiptStorageProbeService(
            session,
            settings=settings,
            s3_client_factory=lambda: StubS3Client(fail_get=True),
        )
        result = await service.run_probe()

    assert result.success is False
    assert "AccessDenied" in (result.error or "")

    async with session_factory() as session_check:
        telemetry = await session_check.get(ReceiptStorageProbeTelemetry, "receipt_storage")
        assert telemetry is not None
        assert telemetry.last_error_at is not None
        assert telemetry.last_success_at is None
        assert "AccessDenied" in (telemetry.last_error_message or "")


@pytest.mark.asyncio
async def test_receipt_storage_probe_worker_run_once(session_factory):
    calls: list[ReceiptStorageProbeResult] = []

    class StubProbeService:
        def __init__(self, session):
            self._session = session

        async def run_probe(self) -> ReceiptStorageProbeResult:
            result = ReceiptStorageProbeResult(success=True, detail="ok", sentinel_key="probe")
            calls.append(result)
            return result

    async def service_factory(session):
        return StubProbeService(session)

    worker = ReceiptStorageProbeWorker(
        session_factory,
        service_factory=lambda session: StubProbeService(session),
        interval_seconds=1,
    )

    result = await worker.run_once()

    assert result.success is True
    assert calls, "Worker should invoke the probe service"
