from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Tuple
from urllib.parse import quote_plus, urlencode

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.fulfillment import FulfillmentProviderOrder
from smplat_api.models.order import Order, OrderItem


class BlueprintMetricsService:
    """Aggregate blueprint adoption metrics for reporting surfaces."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def fetch_metrics(
        self,
        *,
        window_days: int = 30,
        option_limit: int = 50,
        add_on_limit: int = 50,
        provider_limit: int = 50,
        preset_limit: int = 50,
        load_alert_share_threshold: float = 0.6,
        load_alert_delta_threshold: float = 0.2,
        load_alert_min_engagements: int = 10,
        load_alert_short_window: int = 7,
        load_alert_long_window: int = 90,
        load_alert_limit: int = 25,
    ) -> Dict[str, Any]:
        window_days = max(1, min(window_days, 365))
        option_limit = max(1, min(option_limit, 250))
        add_on_limit = max(1, min(add_on_limit, 250))
        provider_limit = max(1, min(provider_limit, 250))
        preset_limit = max(1, min(preset_limit, 250))
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=window_days)

        summary = await self._fetch_summary(window_start)
        options = await self._fetch_options(window_start, option_limit)
        add_ons = await self._fetch_add_ons(window_start, add_on_limit)
        provider_adoption = await self._fetch_provider_usage(window_start, provider_limit)
        presets = await self._fetch_presets(window_start, preset_limit)
        window_candidates = {7, 30, 90, load_alert_short_window, load_alert_long_window}
        preset_provider_engagements = await self._fetch_preset_provider_windows(
            now,
            provider_limit,
            window_candidates,
        )
        provider_load_alerts = self._build_provider_load_alerts(
            preset_provider_engagements,
            short_window=load_alert_short_window,
            long_window=load_alert_long_window,
            share_threshold=load_alert_share_threshold,
            delta_threshold=load_alert_delta_threshold,
            min_engagements=load_alert_min_engagements,
            limit=load_alert_limit,
        )

        return {
            "window": {"days": window_days, "start": window_start.isoformat()},
            "orders": summary,
            "options": options,
            "addOns": add_ons,
            "providerEngagements": provider_adoption,
            "presets": presets,
            "presetProviderEngagements": preset_provider_engagements,
            "providerLoadAlerts": provider_load_alerts,
        }

    async def _fetch_summary(self, window_start: datetime) -> Dict[str, Any]:
        stmt = (
            select(
                func.count(func.distinct(Order.id)).label("orders_total"),
                func.count(OrderItem.id).label("items_total"),
                func.coalesce(func.sum(OrderItem.total_price), 0).label("item_revenue_total"),
            )
            .join(OrderItem, OrderItem.order_id == Order.id)
            .where(Order.created_at >= window_start)
        )
        result = await self._session.execute(stmt)
        row = result.one()
        return {
            "total": int(row.orders_total or 0),
            "items": int(row.items_total or 0),
            "itemRevenue": _to_float(row.item_revenue_total),
        }

    async def _fetch_options(self, window_start: datetime, limit: int) -> List[Dict[str, Any]]:
        selections = await self._fetch_selection_payloads(window_start)
        aggregated: Dict[Tuple[str | None, str | None], Dict[str, Any]] = {}
        for payload in selections:
            for option in payload.get("options") or []:
                group_id = option.get("groupId")
                option_id = option.get("optionId")
                key = (group_id, option_id)
                entry = aggregated.setdefault(
                    key,
                    {
                        "groupId": group_id,
                        "groupName": option.get("groupName"),
                        "optionId": option_id,
                        "label": option.get("label"),
                        "selections": 0,
                        "priceDeltaTotal": 0.0,
                    },
                )
                entry["selections"] += 1
                entry["priceDeltaTotal"] += _to_float(option.get("priceDelta"))

        sorted_entries = sorted(
            aggregated.values(),
            key=lambda entry: entry["selections"],
            reverse=True,
        )
        return sorted_entries[:limit]

    async def _fetch_add_ons(self, window_start: datetime, limit: int) -> List[Dict[str, Any]]:
        selections = await self._fetch_selection_payloads(window_start)
        aggregated: Dict[str | None, Dict[str, Any]] = {}
        for payload in selections:
            for add_on in payload.get("addOns") or []:
                add_on_id = add_on.get("id")
                entry = aggregated.setdefault(
                    add_on_id,
                    {
                        "addOnId": add_on_id,
                        "label": add_on.get("label"),
                        "pricingMode": add_on.get("pricingMode"),
                        "providerName": add_on.get("serviceProviderName"),
                        "selections": 0,
                        "priceDeltaTotal": 0.0,
                    },
                )
                entry["selections"] += 1
                entry["priceDeltaTotal"] += _to_float(add_on.get("priceDelta"))

        sorted_entries = sorted(
            aggregated.values(),
            key=lambda entry: entry["selections"],
            reverse=True,
        )
        return sorted_entries[:limit]

    async def _fetch_provider_usage(self, window_start: datetime, limit: int) -> List[Dict[str, Any]]:
        stmt = (
            select(
                FulfillmentProviderOrder.provider_id,
                FulfillmentProviderOrder.provider_name,
                FulfillmentProviderOrder.service_id,
                FulfillmentProviderOrder.service_action,
                func.count(FulfillmentProviderOrder.id).label("engagements"),
                func.coalesce(func.sum(FulfillmentProviderOrder.amount), 0).label("amount_total"),
            )
            .where(FulfillmentProviderOrder.created_at >= window_start)
            .group_by(
                FulfillmentProviderOrder.provider_id,
                FulfillmentProviderOrder.provider_name,
                FulfillmentProviderOrder.service_id,
                FulfillmentProviderOrder.service_action,
            )
            .order_by(func.count(FulfillmentProviderOrder.id).desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        providers: List[Dict[str, Any]] = []
        for row in result:
            providers.append(
                {
                    "providerId": row.provider_id,
                    "providerName": row.provider_name,
                    "serviceId": row.service_id,
                    "serviceAction": row.service_action,
                    "engagements": int(row.engagements or 0),
                    "amountTotal": _to_float(row.amount_total),
                }
            )
        return providers

    async def _fetch_selection_payloads(self, window_start: datetime) -> List[Mapping[str, Any]]:
        stmt = select(OrderItem.selected_options).join(Order, OrderItem.order_id == Order.id).where(
            Order.created_at >= window_start
        )
        result = await self._session.execute(stmt)
        payloads = []
        for entry in result.scalars():
            if isinstance(entry, Mapping):
                payloads.append(entry)
        return payloads

    async def _fetch_presets(self, window_start: datetime, limit: int) -> List[Dict[str, Any]]:
        selections = await self._fetch_selection_payloads(window_start)
        aggregated: Dict[str, Dict[str, Any]] = {}
        for payload in selections:
            preset_id = payload.get("presetId") or payload.get("preset_id")
            if not preset_id:
                continue
            key = str(preset_id)
            entry = aggregated.setdefault(
                key,
                {
                    "presetId": key,
                    "label": payload.get("presetLabel") or payload.get("preset_label"),
                    "selections": 0,
                },
            )
            entry["selections"] += 1

        sorted_entries = sorted(aggregated.values(), key=lambda entry: entry["selections"], reverse=True)
        return sorted_entries[:limit]

    async def _fetch_preset_provider_windows(
        self,
        now: datetime,
        limit: int,
        window_definitions: Iterable[int] | None = None,
    ) -> Dict[str, Any]:
        window_definitions = sorted({7, 30, 90, *(window_definitions or [])})
        windows: Dict[str, Any] = {}
        for days in window_definitions:
            window_start = now - timedelta(days=days)
            entries = await self._fetch_preset_provider_engagements(window_start, limit)
            windows[str(days)] = {
                "days": days,
                "start": window_start.isoformat(),
                "entries": entries,
            }
        return {
            "generatedAt": now.isoformat(),
            "windows": windows,
        }

    async def _fetch_preset_provider_engagements(self, window_start: datetime, limit: int) -> List[Dict[str, Any]]:
        stmt = (
            select(
                OrderItem.selected_options,
                FulfillmentProviderOrder.provider_id,
                FulfillmentProviderOrder.provider_name,
                FulfillmentProviderOrder.service_id,
                FulfillmentProviderOrder.service_action,
                FulfillmentProviderOrder.currency,
                FulfillmentProviderOrder.amount,
            )
            .join(OrderItem, OrderItem.id == FulfillmentProviderOrder.order_item_id)
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.created_at >= window_start)
        )
        result = await self._session.execute(stmt)

        aggregated: Dict[Tuple[str, str | None, str | None], Dict[str, Any]] = {}
        totals_by_preset: Dict[str, int] = {}
        for row in result:
            payload = row.selected_options if isinstance(row.selected_options, Mapping) else None
            preset_id = None
            preset_label = None
            if payload:
                preset_id = payload.get("presetId") or payload.get("preset_id")
                preset_label = payload.get("presetLabel") or payload.get("preset_label")
            if not preset_id:
                continue
            preset_key = str(preset_id)
            provider_key = (preset_key, row.provider_id, row.service_id)
            entry = aggregated.setdefault(
                provider_key,
                {
                    "presetId": preset_key,
                    "presetLabel": preset_label,
                    "providerId": row.provider_id,
                    "providerName": row.provider_name,
                    "serviceId": row.service_id,
                    "serviceAction": row.service_action,
                    "currency": row.currency,
                    "engagements": 0,
                    "amountTotal": 0.0,
                },
            )
            if not entry.get("presetLabel") and preset_label:
                entry["presetLabel"] = preset_label
            if not entry.get("currency") and row.currency:
                entry["currency"] = row.currency
            entry["engagements"] += 1
            entry["amountTotal"] += _to_float(row.amount)
            totals_by_preset[preset_key] = totals_by_preset.get(preset_key, 0) + 1

        entries = list(aggregated.values())
        for entry in entries:
            preset_total = totals_by_preset.get(entry["presetId"], 0)
            entry["engagementShare"] = (
                float(entry["engagements"]) / preset_total if preset_total > 0 else 0.0
            )

        sorted_entries = sorted(
            entries,
            key=lambda entry: (entry["engagements"], entry["amountTotal"]),
            reverse=True,
        )
        return sorted_entries[:limit]

    def _build_provider_load_alerts(
        self,
        preset_provider_engagements: Mapping[str, Any],
        *,
        short_window: int,
        long_window: int,
        share_threshold: float,
        delta_threshold: float,
        min_engagements: int,
        limit: int,
    ) -> List[Dict[str, Any]]:
        share_threshold = max(0.0, min(share_threshold, 1.0))
        delta_threshold = max(0.0, min(delta_threshold, 1.0))
        min_engagements = max(1, min_engagements)
        limit = max(1, limit)
        windows = preset_provider_engagements.get("windows") if isinstance(preset_provider_engagements, Mapping) else None
        if not isinstance(windows, Mapping):
            return []

        short_key = str(short_window)
        long_key = str(long_window)
        short_entries = self._index_preset_provider_entries(windows.get(short_key))
        long_entries = self._index_preset_provider_entries(windows.get(long_key))

        alerts: List[Dict[str, Any]] = []
        for key, short_entry in short_entries.items():
            short_engagements = short_entry.get("engagements", 0)
            if short_engagements < min_engagements:
                continue
            short_share = float(short_entry.get("engagementShare") or 0.0)
            if short_share < share_threshold:
                continue
            long_entry = long_entries.get(key)
            long_share = float(long_entry.get("engagementShare") or 0.0) if long_entry else 0.0
            share_delta = short_share - long_share
            if share_delta < delta_threshold:
                continue
            alert = {
                "providerId": short_entry.get("providerId"),
                "providerName": short_entry.get("providerName"),
                "presetId": short_entry.get("presetId"),
                "presetLabel": short_entry.get("presetLabel"),
                "serviceId": short_entry.get("serviceId"),
                "serviceAction": short_entry.get("serviceAction"),
                "currency": short_entry.get("currency") or (long_entry.get("currency") if long_entry else None),
                "shortWindowDays": short_window,
                "longWindowDays": long_window,
                "shortShare": short_share,
                "longShare": long_share,
                "shareDelta": share_delta,
                "shortEngagements": int(short_engagements),
                "longEngagements": int(long_entry.get("engagements", 0) if long_entry else 0),
                "shortAmountTotal": short_entry.get("amountTotal", 0.0),
                "longAmountTotal": long_entry.get("amountTotal", 0.0) if long_entry else 0.0,
            }
            alert["links"] = self._build_load_alert_links(alert["presetId"], alert["providerId"])
            alerts.append(alert)

        sorted_alerts = sorted(alerts, key=lambda entry: (entry["shareDelta"], entry["shortShare"]), reverse=True)
        return sorted_alerts[:limit]

    @staticmethod
    def _index_preset_provider_entries(window_payload: Any) -> Dict[Tuple[str | None, str | None, str | None], Dict[str, Any]]:
        if not window_payload or not isinstance(window_payload, Mapping):
            return {}
        entries = window_payload.get("entries")
        if not isinstance(entries, list):
            return {}
        indexed: Dict[Tuple[str | None, str | None, str | None], Dict[str, Any]] = {}
        for entry in entries:
            if not isinstance(entry, Mapping):
                continue
            preset_id = entry.get("presetId")
            provider_id = entry.get("providerId")
            service_id = entry.get("serviceId")
            indexed[(str(preset_id) if preset_id is not None else None, provider_id, service_id)] = dict(entry)
        return indexed

    @staticmethod
    def _build_load_alert_links(preset_id: Any, provider_id: Any) -> Dict[str, str]:
        preset_value = str(preset_id) if preset_id not in (None, "") else None
        provider_value = str(provider_id) if provider_id not in (None, "") else None
        links: Dict[str, str] = {}
        if preset_value:
            links["merchandising"] = f"/admin/merchandising?presetId={quote_plus(preset_value)}"
        if provider_value:
            links["fulfillment"] = f"/admin/fulfillment/providers?providerId={quote_plus(provider_value)}"
        query_params = []
        if preset_value:
            query_params.append(("presetId", preset_value))
        if provider_value:
            query_params.append(("providerId", provider_value))
        if query_params:
            links["orders"] = f"/admin/orders?{urlencode(query_params)}"
        return links


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


__all__ = ["BlueprintMetricsService"]
