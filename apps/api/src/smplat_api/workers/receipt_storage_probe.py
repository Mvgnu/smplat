"""Worker that periodically probes receipt storage and records telemetry."""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.core.settings import settings
from smplat_api.services.orders.receipt_storage_probe import (
    ReceiptStorageProbeResult,
    ReceiptStorageProbeService,
)

SessionFactory = Callable[[], Awaitable[AsyncSession]] | Callable[[], AsyncSession]
ServiceFactory = Callable[[AsyncSession], ReceiptStorageProbeService]


class ReceiptStorageProbeWorker:
    """Runs a sentinel probe loop to verify receipt storage health."""

    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        interval_seconds: int | None = None,
        service_factory: ServiceFactory | None = None,
    ) -> None:
        self._session_factory = session_factory
        self.interval_seconds = interval_seconds or settings.receipt_storage_probe_interval_seconds
        self._service_factory = service_factory
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.is_running: bool = False
        self._logger = logger.bind(worker="receipt_storage_probe")

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        self.is_running = True
        self._logger.info(
            "Receipt storage probe worker started",
            interval_seconds=self.interval_seconds,
        )

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop_event.set()
        await self._task
        self._task = None
        self.is_running = False
        self._logger.info("Receipt storage probe worker stopped")

    async def run_once(self) -> ReceiptStorageProbeResult:
        session = await self._ensure_session()
        async with session as managed_session:
            service = self._build_service(managed_session)
            result = await service.run_probe()
            return result

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                result = await self.run_once()
                self._logger.info(
                    "Receipt storage probe iteration",
                    success=result.success,
                    detail=result.detail,
                    sentinel_key=result.sentinel_key,
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                self._logger.exception("Receipt storage probe iteration failed", error=str(exc))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                continue

    def _build_service(self, session: AsyncSession) -> ReceiptStorageProbeService:
        if self._service_factory:
            return self._service_factory(session)
        return ReceiptStorageProbeService(session)

    async def _ensure_session(self) -> AsyncSession:
        maybe_session = self._session_factory()
        if isinstance(maybe_session, AsyncSession):
            return maybe_session
        return await maybe_session


__all__ = ["ReceiptStorageProbeWorker"]
