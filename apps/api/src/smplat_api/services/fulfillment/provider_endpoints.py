from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, MutableMapping

import httpx


class ProviderEndpointError(RuntimeError):
    """Raised when a provider endpoint cannot be invoked successfully."""

    def __init__(self, message: str, *, url: str | None = None) -> None:
        super().__init__(message)
        self.url = url


def extract_endpoint(metadata: Mapping[str, Any] | None, key: str) -> Mapping[str, Any] | None:
    """Return the automation endpoint configuration for the given key."""

    if not metadata:
        return None
    automation = metadata.get("automation")
    if not isinstance(automation, Mapping):
        return None
    endpoints = automation.get("endpoints")
    if not isinstance(endpoints, Mapping):
        return None
    config = endpoints.get(key)
    return config if isinstance(config, Mapping) else None


def build_metadata_context(metadata: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Extract primitive automation metadata values for template rendering."""

    context: Dict[str, Any] = {}
    if isinstance(metadata, Mapping):
        automation = metadata.get("automation")
        if isinstance(automation, Mapping):
            for key, value in automation.items():
                if isinstance(key, str) and isinstance(value, (str, int, float)):
                    context.setdefault(key, value)
    return context


def _render_template_value(template: str, context: Mapping[str, Any]) -> Any:
    stripped = template.strip()
    if stripped.startswith("{{") and stripped.endswith("}}"):
        key = stripped[2:-2].strip()
        if key in context:
            value = context[key]
            if isinstance(value, (dict, list)):
                return value
            return "" if value is None else str(value)
    rendered = template
    for key, value in context.items():
        placeholder = f"{{{{{key}}}}}"
        if placeholder in rendered:
            rendered = rendered.replace(placeholder, "" if value is None else str(value))
    return rendered


def render_object(obj: Any, context: Mapping[str, Any]) -> Any:
    if isinstance(obj, str):
        return _render_template_value(obj, context)
    if isinstance(obj, list):
        return [render_object(item, context) for item in obj]
    if isinstance(obj, Mapping):
        return {key: render_object(value, context) for key, value in obj.items()}
    return obj


def extract_path(payload: Mapping[str, Any], path: str) -> Any:
    target: Any = payload
    for segment in path.split("."):
        if not isinstance(target, Mapping):
            return None
        target = target.get(segment)
        if target is None:
            return None
    return target


def extract_balance_from_payload(payload: Mapping[str, Any], endpoint: Mapping[str, Any]) -> tuple[float | None, str | None]:
    """Derive balance amount and currency from a provider response."""

    config = endpoint.get("response")
    amount = None
    currency = None
    if isinstance(config, Mapping):
        amount_path = config.get("balancePath")
        currency_path = config.get("currencyPath")
        if isinstance(amount_path, str):
            raw_amount = extract_path(payload, amount_path)
            try:
                amount = float(raw_amount) if raw_amount is not None else None
            except (TypeError, ValueError):
                amount = None
        if isinstance(currency_path, str):
            raw_currency = extract_path(payload, currency_path)
            currency = str(raw_currency) if raw_currency is not None else None
    if amount is None:
        fallback_amount = payload.get("balance") or payload.get("amount")
        try:
            amount = float(fallback_amount) if fallback_amount is not None else None
        except (TypeError, ValueError):
            amount = None
    if currency is None:
        raw_currency = payload.get("currency")
        currency = str(raw_currency) if isinstance(raw_currency, (str, int)) else None
    return amount, currency


def _parse_response_body(response: httpx.Response) -> Mapping[str, Any]:
    content_type = response.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            parsed = response.json()
            if isinstance(parsed, Mapping):
                return parsed
            return {"data": parsed}
        except ValueError:
            return {"text": response.text}
    return {"text": response.text}


@dataclass
class EndpointInvocationResult:
    payload: Mapping[str, Any]
    url: str


async def invoke_provider_endpoint(
    endpoint: Mapping[str, Any],
    *,
    context: Mapping[str, Any] | None = None,
    http_client: httpx.AsyncClient | None = None,
    default_timeout: float = 10.0,
) -> EndpointInvocationResult:
    """Execute the configured endpoint and return the parsed payload."""

    method = str(endpoint.get("method") or "POST").upper()
    url_template = endpoint.get("url")
    if not isinstance(url_template, str) or not url_template.strip():
        raise ProviderEndpointError("Endpoint URL is not configured")

    timeout_seconds = endpoint.get("timeoutSeconds")
    timeout = timeout_seconds if isinstance(timeout_seconds, (int, float)) and timeout_seconds > 0 else default_timeout

    render_context = dict(context or {})
    headers_template = endpoint.get("headers")
    body_template = endpoint.get("payload")

    url = _render_template_value(url_template, render_context)
    headers = render_object(headers_template, render_context) if isinstance(headers_template, Mapping) else {}
    body = render_object(body_template, render_context) if isinstance(body_template, Mapping) else None

    client = http_client or httpx.AsyncClient(timeout=timeout)
    owns_client = http_client is None

    try:
        request_kwargs: Dict[str, Any] = {"method": method, "url": url, "headers": headers}
        if body is not None:
            request_kwargs["json"] = body
        response = await client.request(**request_kwargs)
        response.raise_for_status()
        payload = _parse_response_body(response)
        return EndpointInvocationResult(payload=payload, url=url)
    except httpx.HTTPError as exc:
        raise ProviderEndpointError(str(exc), url=url) from exc
    finally:
        if owns_client:
            await client.aclose()


def append_refill_entry(target: MutableMapping[str, Any], entry: Mapping[str, Any]) -> None:
    """Track a refill attempt inside the provider order payload."""

    refills = target.get("refills")
    if isinstance(refills, list):
        refills.append(dict(entry))
        return
    target["refills"] = [dict(entry)]


__all__ = [
    "EndpointInvocationResult",
    "ProviderEndpointError",
    "append_refill_entry",
    "build_metadata_context",
    "extract_balance_from_payload",
    "extract_endpoint",
    "extract_path",
    "invoke_provider_endpoint",
    "render_object",
]
