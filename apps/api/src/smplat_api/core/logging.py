from __future__ import annotations

import json
import logging
from logging import LogRecord
from typing import Any, Dict

from loguru import logger
from opentelemetry import trace


_RESERVED_LOG_RECORD_ATTRS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
}


class InterceptHandler(logging.Handler):
    """Bridge standard logging records into Loguru with structured context."""

    def emit(self, record: LogRecord) -> None:  # pragma: no cover - bridging glue
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - safety against malformed format strings
            message = record.msg if isinstance(record.msg, str) else str(record.msg)

        extra = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_LOG_RECORD_ATTRS
        }

        safe_message = message.replace("{", "{{").replace("}", "}}")

        bound_logger = logger.bind(**extra) if extra else logger
        bound_logger.opt(depth=6, exception=record.exc_info, record=True).log(
            level, safe_message
        )


def _serialize_log(message: "logger.Message", metadata: Dict[str, Any]) -> None:
    record = message.record
    span = trace.get_current_span()
    span_context = span.get_span_context() if span else None

    payload: Dict[str, Any] = {
        "timestamp": record["time"].isoformat(),
        "level": record["level"].name.lower(),
        "message": record["message"],
        "logger": record["name"],
        "service": metadata.get("service_name", "unknown"),
        "environment": metadata.get("environment", "unknown"),
        "version": metadata.get("version", "unknown"),
    }

    if span_context and span_context.is_valid:
        payload["trace_id"] = f"{span_context.trace_id:032x}"
        payload["span_id"] = f"{span_context.span_id:016x}"

    if record["extra"]:
        payload.update(record["extra"])

    serialized = json.dumps(payload, default=str)
    print(serialized)


def configure_logging(*, service_name: str, environment: str, version: str) -> None:
    """Configure Loguru + stdlib logging with structured JSON output."""

    logger.remove()
    metadata = {"service_name": service_name, "environment": environment, "version": version}
    logger.add(lambda message: _serialize_log(message, metadata), backtrace=False, diagnose=False)

    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
