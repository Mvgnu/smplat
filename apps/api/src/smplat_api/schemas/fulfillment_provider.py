from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Literal, Mapping
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ProviderStatus = Literal["active", "inactive"]
ServiceStatus = Literal["active", "inactive"]
HealthStatus = Literal["unknown", "healthy", "degraded", "offline"]


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=_to_camel)


class ProviderServiceCostTier(_CamelModel):
    """Tier descriptor for provider cost models."""

    up_to: int | None = Field(default=None, ge=1)
    unit_amount: float = Field(default=0, ge=0)
    label: str | None = Field(default=None, max_length=120)


class ProviderServiceCostModel(_CamelModel):
    """Structured cost definition for a provider service."""

    kind: Literal["flat", "per_unit", "tiered"]
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    unit: str | None = Field(default=None, max_length=64)
    unit_amount: float | None = Field(default=None, ge=0)
    minimum_units: int | None = Field(default=None, ge=1)
    tiers: list[ProviderServiceCostTier] | None = Field(default=None)


class ProviderServiceCadence(_CamelModel):
    """Operational cadence hints for a provider service."""

    batch_size: int | None = Field(default=None, ge=1)
    default_daily_quota: int | None = Field(default=None, ge=1)
    fulfillment_window_hours: int | None = Field(default=None, ge=1)
    refill_window_hours: int | None = Field(default=None, ge=0)
    expected_completion_hours: int | None = Field(default=None, ge=0)
    supports_refill: bool = Field(default=True)
    notes: str | None = Field(default=None, max_length=500)


class ProviderServiceFieldOption(_CamelModel):
    label: str = Field(..., max_length=120)
    value: str | int | float = Field(...)


class ProviderServiceConfigurationField(_CamelModel):
    key: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=120)
    input_type: Literal["string", "number", "integer", "boolean", "select"] = Field(default="string")
    required: bool = Field(default=False)
    description: str | None = Field(default=None, max_length=500)
    options: list[ProviderServiceFieldOption] | None = Field(default=None)
    default_value: str | int | float | bool | None = Field(default=None)


class ProviderServiceConfiguration(_CamelModel):
    schema_type: Literal["json_schema", "key_value"] = Field(default="key_value")
    json_schema: dict[str, Any] | None = Field(default=None)
    fields: list[ProviderServiceConfigurationField] | None = Field(default=None)


class ProviderServiceGuardrails(_CamelModel):
    minimum_margin_percent: float | None = Field(default=None)
    warning_margin_percent: float | None = Field(default=None)
    minimum_margin_absolute: float | None = Field(default=None)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = Field(default=None, max_length=240)


class ProviderServiceDefaultInputs(_CamelModel):
    quantity: float | None = Field(default=None, ge=0)
    duration_days: int | None = Field(default=None, ge=0)
    rate_per_day: float | None = Field(default=None, ge=0)
    geo: str | None = Field(default=None, max_length=64)


class ProviderServicePayloadTemplate(_CamelModel):
    operation: Literal["order", "refill", "balance", "cancel"]
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = Field(default="POST")
    path: str = Field(..., min_length=1, max_length=255)
    headers: dict[str, str] | None = Field(default=None)
    body_template: dict[str, Any] | None = Field(default=None)
    success_codes: list[int] | None = Field(default=None)
    response_mappings: dict[str, str] | None = Field(default=None)


class ProviderServiceMetadata(_CamelModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=_to_camel, extra="allow")

    version: int = Field(default=1, ge=1)
    cost_model: ProviderServiceCostModel | None = Field(default=None)
    cadence: ProviderServiceCadence | None = Field(default=None)
    configuration: ProviderServiceConfiguration | None = Field(default=None)
    guardrails: ProviderServiceGuardrails | None = Field(default=None)
    payload_templates: list[ProviderServicePayloadTemplate] = Field(default_factory=list)
    default_inputs: ProviderServiceDefaultInputs | None = Field(default=None)
    legacy: dict[str, Any] | None = Field(default=None)


class FulfillmentServiceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    action: str = Field(..., min_length=1, max_length=255)
    category: str | None = Field(None, max_length=255)
    default_currency: str | None = Field(None, min_length=3, max_length=3)
    allowed_regions: list[str] | None = Field(default=None)
    rate_limit_per_minute: int | None = Field(default=None, ge=0)
    metadata: ProviderServiceMetadata | dict[str, Any] | None = Field(default=None)
    credentials: dict[str, Any] | None = Field(default=None)
    status: ServiceStatus = Field(default="active")
    health_status: HealthStatus | None = Field(default=None)


class FulfillmentServiceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    action: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=255)
    default_currency: str | None = Field(default=None, min_length=3, max_length=3)
    allowed_regions: list[str] | None = Field(default=None)
    rate_limit_per_minute: int | None = Field(default=None, ge=0)
    metadata: ProviderServiceMetadata | dict[str, Any] | None = Field(default=None)
    credentials: dict[str, Any] | None = Field(default=None)
    status: ServiceStatus | None = Field(default=None)
    health_status: HealthStatus | None = Field(default=None)
    last_health_check_at: datetime | None = Field(default=None)
    health_payload: dict[str, Any] | None = Field(default=None)


class FulfillmentServiceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: str
    provider_id: str = Field(alias="providerId")
    name: str
    action: str
    category: str | None = None
    default_currency: str | None = Field(default=None, alias="defaultCurrency")
    status: ServiceStatus
    health_status: HealthStatus = Field(alias="healthStatus")
    allowed_regions: list[str] = Field(default_factory=list, alias="allowedRegions")
    rate_limit_per_minute: int | None = Field(default=None, alias="rateLimitPerMinute")
    metadata: ProviderServiceMetadata = Field(default_factory=ProviderServiceMetadata)
    credentials: dict[str, Any] | None = None
    last_health_check_at: datetime | None = Field(default=None, alias="lastHealthCheckAt")
    health_payload: dict[str, Any] = Field(default_factory=dict, alias="healthPayload")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if isinstance(data, dict):
            metadata_payload = data.pop("metadata_json", None) or data.get("metadata") or {}
            if not isinstance(metadata_payload, ProviderServiceMetadata):
                try:
                    data["metadata"] = ProviderServiceMetadata.model_validate(metadata_payload or {})
                except Exception:
                    data["metadata"] = ProviderServiceMetadata.model_validate({"legacy": metadata_payload or {}})
            else:
                data["metadata"] = metadata_payload
            data.setdefault("allowedRegions", data.pop("allowed_regions", None) or [])
            data.setdefault("healthPayload", data.pop("health_payload", None) or {})
            data.setdefault("rateLimitPerMinute", data.get("rate_limit_per_minute"))
            data.setdefault("defaultCurrency", data.get("default_currency"))
            data.setdefault("providerId", data.get("provider_id"))
            data.setdefault("healthStatus", data.get("health_status"))
            data.setdefault("lastHealthCheckAt", data.get("last_health_check_at"))
            data.setdefault("createdAt", data.get("created_at"))
            data.setdefault("updatedAt", data.get("updated_at"))
        return data


class FulfillmentProviderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None)
    base_url: str | None = Field(default=None, max_length=512)
    allowed_regions: list[str] | None = Field(default=None)
    rate_limit_per_minute: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] | None = Field(default=None)
    credentials: dict[str, Any] | None = Field(default=None)
    status: ProviderStatus = Field(default="active")
    health_status: HealthStatus | None = Field(default=None)


class FulfillmentProviderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None)
    base_url: str | None = Field(default=None, max_length=512)
    allowed_regions: list[str] | None = Field(default=None)
    rate_limit_per_minute: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] | None = Field(default=None)
    credentials: dict[str, Any] | None = Field(default=None)
    status: ProviderStatus | None = Field(default=None)
    health_status: HealthStatus | None = Field(default=None)
    last_health_check_at: datetime | None = Field(default=None)
    health_payload: dict[str, Any] | None = Field(default=None)


class FulfillmentProviderResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: str
    name: str
    description: str | None = None
    base_url: str | None = Field(default=None, alias="baseUrl")
    status: ProviderStatus
    health_status: HealthStatus = Field(alias="healthStatus")
    allowed_regions: list[str] = Field(default_factory=list, alias="allowedRegions")
    rate_limit_per_minute: int | None = Field(default=None, alias="rateLimitPerMinute")
    metadata: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, Any] | None = None
    last_health_check_at: datetime | None = Field(default=None, alias="lastHealthCheckAt")
    health_payload: dict[str, Any] = Field(default_factory=dict, alias="healthPayload")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    services: list[FulfillmentServiceResponse] = Field(default_factory=list)
    balance_snapshot: "FulfillmentProviderBalanceSnapshot | None" = Field(default=None, alias="balanceSnapshot")

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data.setdefault("metadata", data.pop("metadata_json", None) or {})
            data.setdefault("allowedRegions", data.pop("allowed_regions", None) or [])
            data.setdefault("healthPayload", data.pop("health_payload", None) or {})
            data.setdefault("baseUrl", data.get("base_url"))
            data.setdefault("healthStatus", data.get("health_status"))
            data.setdefault("lastHealthCheckAt", data.get("last_health_check_at"))
            data.setdefault("rateLimitPerMinute", data.get("rate_limit_per_minute"))
            data.setdefault("createdAt", data.get("created_at"))
            data.setdefault("updatedAt", data.get("updated_at"))
            if "services" in data and isinstance(data["services"], Iterable):
                data["services"] = [
                    FulfillmentServiceResponse.model_validate(service) for service in data["services"]
                ]
            snapshot = data.pop("balance_snapshot", None)
            if isinstance(snapshot, dict):
                data["balanceSnapshot"] = snapshot
            elif snapshot is not None:
                data["balanceSnapshot"] = {
                    "amount": snapshot.balance_amount,
                    "currency": snapshot.currency,
                    "retrievedAt": snapshot.retrieved_at,
                }
        return data


class FulfillmentProviderBalanceSnapshot(BaseModel):
    amount: float | None = Field(default=None, alias="amount")
    currency: str | None = Field(default=None, alias="currency")
    retrieved_at: datetime | None = Field(default=None, alias="retrievedAt")
    payload: dict[str, Any] | None = Field(default=None, alias="payload")


class FulfillmentProviderOrderRefillEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    amount: float | None = None
    currency: str | None = None
    performed_at: datetime = Field(alias="performedAt")
    response: dict[str, Any] | None = Field(default=None, alias="response")


class FulfillmentProviderOrderReplayEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    requested_amount: float | None = Field(default=None, alias="requestedAmount")
    currency: str | None = None
    performed_at: datetime | None = Field(default=None, alias="performedAt")
    scheduled_for: datetime | None = Field(default=None, alias="scheduledFor")
    status: Literal["executed", "scheduled", "failed"] = "executed"
    response: dict[str, Any] | None = Field(default=None, alias="response")
    rule_ids: list[str] | None = Field(default=None, alias="ruleIds")
    rule_metadata: dict[str, Any] | None = Field(default=None, alias="ruleMetadata")


class FulfillmentProviderOrderResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    provider_id: str = Field(alias="providerId")
    provider_name: str | None = Field(default=None, alias="providerName")
    service_id: str = Field(alias="serviceId")
    service_action: str | None = Field(default=None, alias="serviceAction")
    order_id: UUID = Field(alias="orderId")
    order_item_id: UUID = Field(alias="orderItemId")
    amount: float | None = None
    currency: str | None = None
    provider_order_id: str | None = Field(default=None, alias="providerOrderId")
    payload: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    refills: list[FulfillmentProviderOrderRefillEntry] = Field(default_factory=list)
    replays: list[FulfillmentProviderOrderReplayEntry] = Field(default_factory=list)
    scheduled_replays: list[FulfillmentProviderOrderReplayEntry] = Field(default_factory=list, alias="scheduledReplays")

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if isinstance(data, Mapping):
            normalized: dict[str, Any] = dict(data)
        else:
            normalized = cls._from_attributes(data)
            if not normalized:
                return data
        payload = normalized.get("payload")
        payload_map = payload if isinstance(payload, Mapping) else None

        if payload_map:
            provider_order_id = payload_map.get("providerOrderId") or payload_map.get("provider_order_id")
            if provider_order_id:
                normalized.setdefault("providerOrderId", provider_order_id)

            refills = cls._extract_entry_list(payload_map.get("refills"))
            if refills is not None:
                normalized["refills"] = refills

            replays = cls._extract_entry_list(payload_map.get("replays"))
            if replays is not None:
                normalized["replays"] = replays

            scheduled_replays = cls._extract_entry_list(payload_map.get("scheduledReplays"))
            if scheduled_replays is None:
                scheduled_replays = cls._extract_entry_list(payload_map.get("scheduled_replays"))
            if scheduled_replays is not None:
                normalized["scheduledReplays"] = scheduled_replays

        return normalized

    @staticmethod
    def _extract_entry_list(raw: Any) -> list[dict[str, Any]] | None:
        if not isinstance(raw, list):
            return None
        entries: list[dict[str, Any]] = []
        for entry in raw:
            if isinstance(entry, Mapping):
                entries.append(dict(entry))
        return entries

    @staticmethod
    def _from_attributes(obj: Any) -> dict[str, Any]:
        if obj is None:
            return {}
        fields = [
            "id",
            "provider_id",
            "provider_name",
            "service_id",
            "service_action",
            "order_id",
            "order_item_id",
            "amount",
            "currency",
            "provider_order_id",
            "payload",
            "created_at",
            "updated_at",
        ]
        normalized: dict[str, Any] = {}
        for field in fields:
            if hasattr(obj, field):
                normalized[field] = getattr(obj, field)
        return normalized


class FulfillmentProviderOrderRefillRequest(BaseModel):
    amount: float | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)
    actorLabel: str | None = Field(default=None, alias="actorLabel")


class FulfillmentProviderOrderReplayRequest(BaseModel):
    amount: float | None = Field(default=None, ge=0)
    run_at: datetime | None = Field(default=None, alias="runAt")
    schedule_only: bool = Field(default=False, alias="scheduleOnly")


class ProviderAutomationGuardrailSummary(_CamelModel):
    evaluated: int = 0
    pass_count: int = Field(default=0, alias="pass")
    warn: int = 0
    fail: int = 0


class ProviderAutomationReplaySummary(_CamelModel):
    total: int = 0
    executed: int = 0
    failed: int = 0
    scheduled: int = 0


class ProviderAutomationRuleEntry(_CamelModel):
    id: str
    label: str | None = None
    count: int = 0


class ProviderAutomationRuleSummary(_CamelModel):
    total_overrides: int = Field(default=0, alias="totalOverrides")
    rules: dict[str, ProviderAutomationRuleEntry] = Field(default_factory=dict)


class ProviderAutomationRunStatus(_CamelModel):
    ran_at: datetime = Field(alias="ranAt")
    summary: dict[str, Any]
    metadata: dict[str, Any] | None = None


class ProviderAutomationStatusResponse(_CamelModel):
    replay: ProviderAutomationRunStatus | None = None
    alerts: ProviderAutomationRunStatus | None = None


class ProviderAutomationHistoryResponse(_CamelModel):
    replay: list[ProviderAutomationRunStatus] = Field(default_factory=list)
    alerts: list[ProviderAutomationRunStatus] = Field(default_factory=list)


class ProviderAutomationTelemetry(_CamelModel):
    total_orders: int = Field(default=0, alias="totalOrders")
    replays: ProviderAutomationReplaySummary = Field(default_factory=ProviderAutomationReplaySummary)
    guardrails: ProviderAutomationGuardrailSummary = Field(default_factory=ProviderAutomationGuardrailSummary)
    guardrail_hits_by_service: dict[str, ProviderAutomationGuardrailSummary] = Field(
        default_factory=dict,
        alias="guardrailHitsByService",
    )
    rule_overrides_by_service: dict[str, ProviderAutomationRuleSummary] = Field(
        default_factory=dict,
        alias="ruleOverridesByService",
    )


class ProviderAutomationSnapshotProviderEntry(_CamelModel):
    id: str
    name: str
    telemetry: ProviderAutomationTelemetry


class ProviderAutomationSnapshotResponse(_CamelModel):
    aggregated: ProviderAutomationTelemetry
    providers: list[ProviderAutomationSnapshotProviderEntry]
