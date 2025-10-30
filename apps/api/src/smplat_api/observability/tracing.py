from __future__ import annotations

import os
from typing import Dict

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter, SpanExporter
from opentelemetry.semconv.resource import ResourceAttributes

_CONFIGURED = False


def _build_exporter() -> SpanExporter:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    headers_env = os.getenv("OTEL_EXPORTER_OTLP_HEADERS")

    if endpoint:
        headers: Dict[str, str] | None = None
        if headers_env:
            headers = {}
            for pair in headers_env.split(","):
                if not pair:
                    continue
                if "=" not in pair:
                    continue
                key, value = pair.split("=", 1)
                headers[key.strip()] = value.strip()
        return OTLPSpanExporter(endpoint=endpoint, headers=headers)

    return ConsoleSpanExporter()


def configure_tracing(
    app: FastAPI,
    *,
    service_name: str,
    service_version: str,
    environment: str,
) -> None:
    """Configure OpenTelemetry tracing + log correlation for the FastAPI app."""

    global _CONFIGURED

    resource = Resource.create(
        {
            ResourceAttributes.SERVICE_NAME: service_name,
            ResourceAttributes.SERVICE_VERSION: service_version,
            ResourceAttributes.DEPLOYMENT_ENVIRONMENT: environment,
        }
    )

    if not _CONFIGURED:
        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(BatchSpanProcessor(_build_exporter()))
        trace.set_tracer_provider(tracer_provider)
        LoggingInstrumentor().instrument(set_logging_format=False)
        _CONFIGURED = True
    else:
        tracer_provider = trace.get_tracer_provider()

    FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider)


__all__ = ["configure_tracing"]
