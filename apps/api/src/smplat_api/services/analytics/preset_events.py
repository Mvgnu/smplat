from __future__ import annotations

from collections import deque
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Tuple

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.models.analytics import CheckoutOfferEvent, PresetEventDailyMetric


PRESET_EVENT_TYPES = [
    "preset_cta_apply",
    "preset_configurator_apply",
    "preset_configurator_clear",
]


class PresetEventDailyMetricService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def ensure_range(self, start_date: date, end_date: date) -> List[PresetEventDailyMetric]:
        existing_rows = await self._session.execute(
            select(PresetEventDailyMetric).where(
                and_(
                    PresetEventDailyMetric.metric_date >= start_date,
                    PresetEventDailyMetric.metric_date <= end_date,
                )
            ).order_by(PresetEventDailyMetric.metric_date)
        )
        existing_map = {row.metric_date: row for row in existing_rows.scalars()}

        current_date = start_date
        while current_date <= end_date:
            metric = existing_map.get(current_date)
            if metric is None:
                metric = await self._compute_metric(current_date)
                existing_map[current_date] = metric
            current_date += timedelta(days=1)

        ordered_dates = sorted(existing_map.keys())
        ordered_metrics = [existing_map[day] for day in ordered_dates]
        self._annotate_trend_stats(ordered_metrics)
        await self._session.flush()
        return ordered_metrics

    async def _compute_metric(self, metric_date: date) -> PresetEventDailyMetric:
        start_dt = datetime.combine(metric_date, time.min, tzinfo=timezone.utc)
        end_dt = start_dt + timedelta(days=1)

        conditions = [
            CheckoutOfferEvent.created_at >= start_dt,
            CheckoutOfferEvent.created_at < end_dt,
            CheckoutOfferEvent.event_type.in_(PRESET_EVENT_TYPES),
            func.coalesce(CheckoutOfferEvent.metadata_json["presetId"].astext, "") != "",
        ]

        totals_stmt = (
            select(CheckoutOfferEvent.event_type, func.count().label("count"))
            .where(*conditions)
            .group_by(CheckoutOfferEvent.event_type)
        )
        totals_result = await self._session.execute(totals_stmt)
        totals_map = {row.event_type: int(row.count or 0) for row in totals_result}

        sources_stmt = (
            select(
                CheckoutOfferEvent.event_type,
                func.coalesce(CheckoutOfferEvent.metadata_json["source"].astext, "unknown").label("source"),
                func.count().label("count"),
            )
            .where(*conditions)
            .group_by(CheckoutOfferEvent.event_type, "source")
        )
        sources_result = await self._session.execute(sources_stmt)
        source_counts = [
            {
                "eventType": row.event_type,
                "source": row.source,
                "count": int(row.count or 0),
            }
            for row in sources_result
        ]

        metric = await self._session.execute(
            select(PresetEventDailyMetric).where(PresetEventDailyMetric.metric_date == metric_date)
        )
        existing = metric.scalar_one_or_none()

        if existing:
            existing.preset_cta_apply_count = totals_map.get("preset_cta_apply", 0)
            existing.preset_configurator_apply_count = totals_map.get("preset_configurator_apply", 0)
            existing.preset_configurator_clear_count = totals_map.get("preset_configurator_clear", 0)
            existing.source_counts = source_counts
            return existing

        new_metric = PresetEventDailyMetric(
            metric_date=metric_date,
            preset_cta_apply_count=totals_map.get("preset_cta_apply", 0),
            preset_configurator_apply_count=totals_map.get("preset_configurator_apply", 0),
            preset_configurator_clear_count=totals_map.get("preset_configurator_clear", 0),
            source_counts=source_counts,
            trend_stats={},
        )
        self._session.add(new_metric)
        return new_metric

    def _annotate_trend_stats(self, metrics: List[PresetEventDailyMetric]) -> None:
        if not metrics:
            return

        applies_window_7: deque[int] = deque()
        applies_sum_7 = 0
        applies_window_30: deque[int] = deque()
        applies_sum_30 = 0
        clears_window_7: deque[int] = deque()
        clears_sum_7 = 0
        net_window_7: deque[int] = deque()
        net_sum_7 = 0
        total_window_30: deque[int] = deque()
        total_sum_30 = 0

        for metric in metrics:
            cta = metric.preset_cta_apply_count or 0
            configurator_apply = metric.preset_configurator_apply_count or 0
            clears = metric.preset_configurator_clear_count or 0
            applies = cta + configurator_apply
            total = applies + clears
            net = applies - clears

            applies_window_7.append(applies)
            applies_sum_7 += applies
            if len(applies_window_7) > 7:
                applies_sum_7 -= applies_window_7.popleft()

            applies_window_30.append(applies)
            applies_sum_30 += applies
            if len(applies_window_30) > 30:
                applies_sum_30 -= applies_window_30.popleft()

            clears_window_7.append(clears)
            clears_sum_7 += clears
            if len(clears_window_7) > 7:
                clears_sum_7 -= clears_window_7.popleft()

            net_window_7.append(net)
            net_sum_7 += net
            if len(net_window_7) > 7:
                net_sum_7 -= net_window_7.popleft()

            total_window_30.append(total)
            total_sum_30 += total
            if len(total_window_30) > 30:
                total_sum_30 -= total_window_30.popleft()

            apply_avg_7 = applies_sum_7 / len(applies_window_7) if applies_window_7 else 0.0
            apply_avg_30 = applies_sum_30 / len(applies_window_30) if applies_window_30 else 0.0
            net_avg_7 = net_sum_7 / len(net_window_7) if net_window_7 else 0.0
            clear_rate_7 = clears_sum_7 / applies_sum_7 if applies_sum_7 > 0 else 0.0
            total_avg_30 = total_sum_30 / len(total_window_30) if total_window_30 else 0.0
            total_min_30 = min(total_window_30) if total_window_30 else total
            total_max_30 = max(total_window_30) if total_window_30 else total

            metric.trend_stats = {
                "applyAvg7": apply_avg_7,
                "applyAvg30": apply_avg_30,
                "netAvg7": net_avg_7,
                "clearRate7": clear_rate_7,
                "totalAvg30": total_avg_30,
                "totalMin30": total_min_30,
                "totalMax30": total_max_30,
            }


class PresetEventAnalyticsService:
    """Aggregate preset interaction analytics using persisted daily metrics."""

    _COHORT_WINDOWS: Dict[str, int] = {
        "short": 7,
        "medium": 30,
        "long": 90,
    }

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._daily_metric_service = PresetEventDailyMetricService(session)

    async def fetch_summary(self, *, window_days: int = 30) -> Dict[str, Any]:
        window_days = max(1, min(window_days, 90))
        now = datetime.now(timezone.utc)
        end_date = now.date()
        start_date = end_date - timedelta(days=window_days - 1)

        metrics = await self._daily_metric_service.ensure_range(start_date, end_date)
        await self._session.commit()

        totals = self._aggregate_totals(metrics)
        sources = self._aggregate_sources(metrics)
        timeline = self._build_timeline(metrics)
        breakdowns = await self._build_breakdowns(start_date, end_date)
        alerts = self._evaluate_alerts(metrics, breakdowns=breakdowns)

        return {
            "window": {"days": window_days, "start": start_date.isoformat()},
            "totals": totals,
            "sources": sources,
            "timeline": timeline,
            "breakdowns": breakdowns,
            "alerts": alerts,
        }

    def _aggregate_totals(self, metrics: Iterable[PresetEventDailyMetric]) -> Dict[str, int]:
        totals = {event: 0 for event in PRESET_EVENT_TYPES}
        for metric in metrics:
            totals["preset_cta_apply"] += metric.preset_cta_apply_count
            totals["preset_configurator_apply"] += metric.preset_configurator_apply_count
            totals["preset_configurator_clear"] += metric.preset_configurator_clear_count
        return totals

    def _aggregate_sources(self, metrics: Iterable[PresetEventDailyMetric]) -> List[Dict[str, Any]]:
        combined: Dict[Tuple[str, str], int] = {}
        for metric in metrics:
            for entry in metric.source_counts or []:
                event_type = entry.get("eventType") or "unknown"
                source = entry.get("source") or "unknown"
                key = (event_type, source)
                combined[key] = combined.get(key, 0) + int(entry.get("count") or 0)

        return [
            {"eventType": key[0], "source": key[1], "count": count}
            for key, count in combined.items()
            if count > 0
        ]

    def _build_timeline(self, metrics: Iterable[PresetEventDailyMetric]) -> List[Dict[str, Any]]:
        timeline: List[Dict[str, Any]] = []
        for metric in metrics:
            date_str = metric.metric_date.isoformat()
            cta = metric.preset_cta_apply_count or 0
            configurator_apply = metric.preset_configurator_apply_count or 0
            clears = metric.preset_configurator_clear_count or 0
            applies = cta + configurator_apply
            total = applies + clears
            timeline.append(
                {
                    "date": date_str,
                    "counts": {
                        "presetCtaApply": cta,
                        "presetConfiguratorApply": configurator_apply,
                        "presetConfiguratorClear": clears,
                    },
                    "totals": {
                        "applies": applies,
                        "clears": clears,
                        "total": total,
                        "net": applies - clears,
                        "clearRate": clears / max(applies, 1) if applies else 0.0,
                    },
                    "trend": metric.trend_stats or {},
                }
            )
        return timeline

    async def _build_breakdowns(self, start_date: date, end_date: date) -> Dict[str, Any]:
        bucket_stats_preset: Dict[str, Dict[str, Dict[str, Any]]] = {}
        bucket_stats_source: Dict[str, Dict[str, Dict[str, Any]]] = {}
        end_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc)

        for bucket_name, bucket_days in self._COHORT_WINDOWS.items():
            bucket_start_date = max(start_date, end_date - timedelta(days=bucket_days - 1))
            bucket_start_dt = datetime.combine(bucket_start_date, time.min, tzinfo=timezone.utc)
            bucket_stats_preset[bucket_name] = await self._fetch_preset_stats(bucket_start_dt, end_dt)
            bucket_stats_source[bucket_name] = await self._fetch_source_stats(bucket_start_dt, end_dt)

        preset_entries: List[Dict[str, Any]] = []
        risky_presets: List[Dict[str, Any]] = []
        all_preset_ids = set().union(*(stats.keys() for stats in bucket_stats_preset.values()))
        for preset_id in all_preset_ids:
            windows: Dict[str, Dict[str, Any]] = {}
            label = preset_id
            medium_stats = bucket_stats_preset.get("medium", {}).get(preset_id)
            for bucket_name, stats_map in bucket_stats_preset.items():
                stats = stats_map.get(preset_id)
                if stats:
                    if stats.get("presetLabel"):
                        label = stats["presetLabel"]
                    windows[bucket_name] = self._build_window_stat(stats)
            representative_stats = medium_stats or bucket_stats_preset.get("long", {}).get(preset_id) or next(
                (stats_map.get(preset_id) for stats_map in bucket_stats_preset.values() if stats_map.get(preset_id)),
                {"cta": 0, "configurator": 0, "clears": 0},
            )
            entry = {
                "presetId": preset_id,
                "presetLabel": label,
                "cta": int(representative_stats.get("cta", 0)),
                "configurator": int(representative_stats.get("configurator", 0)),
                "clears": int(representative_stats.get("clears", 0)),
                "applies": int(representative_stats.get("cta", 0)) + int(representative_stats.get("configurator", 0)),
                "net": (int(representative_stats.get("cta", 0)) + int(representative_stats.get("configurator", 0)))
                - int(representative_stats.get("clears", 0)),
                "clearRate": (windows.get("medium") or windows.get("long") or windows.get("short") or {}).get(
                    "clearRate", 0.0
                ),
                "windows": windows,
            }
            long_window = windows.get("medium") or windows.get("long")
            is_risky = long_window is not None and long_window["applies"] >= 10 and long_window["clearRate"] >= 0.4
            entry["isRisky"] = is_risky
            entry["riskReason"] = "High clear rate" if is_risky else None
            if is_risky:
                risky_presets.append(entry)
            preset_entries.append(entry)

        preset_entries.sort(
            key=lambda entry: entry["windows"].get("medium", entry["windows"].get("long", {})).get("applies", 0),
            reverse=True,
        )

        source_entries: List[Dict[str, Any]] = []
        all_sources = set().union(*(stats.keys() for stats in bucket_stats_source.values()))
        for source in all_sources:
            windows: Dict[str, Dict[str, Any]] = {}
            representative_stats = None
            for bucket_name, stats_map in bucket_stats_source.items():
                stats = stats_map.get(source)
                if stats:
                    if representative_stats is None and bucket_name == "medium":
                        representative_stats = stats
                    windows[bucket_name] = self._build_window_stat(stats)
            if representative_stats is None:
                representative_stats = (
                    bucket_stats_source.get("long", {}).get(source)
                    or bucket_stats_source.get("short", {}).get(source)
                    or {"cta": 0, "configurator": 0, "clears": 0}
                )
            applies = int(representative_stats.get("cta", 0)) + int(representative_stats.get("configurator", 0))
            clears = int(representative_stats.get("clears", 0))
            source_entries.append(
                {
                    "source": source,
                    "cta": int(representative_stats.get("cta", 0)),
                    "configurator": int(representative_stats.get("configurator", 0)),
                    "clears": clears,
                    "applies": applies,
                    "net": applies - clears,
                    "clearRate": (windows.get("medium") or windows.get("long") or windows.get("short") or {}).get(
                        "clearRate", 0.0
                    ),
                    "windows": windows,
                }
            )
        source_entries.sort(
            key=lambda entry: entry["windows"].get("medium", entry["windows"].get("long", {})).get("applies", 0),
            reverse=True,
        )

        return {
            "presets": preset_entries,
            "sources": source_entries,
            "riskyPresets": risky_presets,
        }

    async def _fetch_preset_stats(self, start_dt: datetime, end_dt: datetime) -> Dict[str, Dict[str, Any]]:
        conditions = [
            CheckoutOfferEvent.created_at >= start_dt,
            CheckoutOfferEvent.created_at < end_dt,
            func.coalesce(CheckoutOfferEvent.metadata_json["presetId"].astext, "") != "",
            CheckoutOfferEvent.event_type.in_(PRESET_EVENT_TYPES),
        ]

        cta_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_cta_apply", 1), else_=0)
        ).label("cta_count")
        config_apply_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_configurator_apply", 1), else_=0)
        ).label("config_apply_count")
        clears_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_configurator_clear", 1), else_=0)
        ).label("clear_count")

        breakdown_stmt = (
            select(
                func.coalesce(CheckoutOfferEvent.metadata_json["presetId"].astext, "").label("preset_id"),
                func.max(CheckoutOfferEvent.metadata_json["presetLabel"].astext).label("preset_label"),
                cta_case,
                config_apply_case,
                clears_case,
            )
            .where(*conditions)
            .group_by("preset_id")
        )
        result = await self._session.execute(breakdown_stmt)
        rows = result.all()
        stats: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            preset_id = row.preset_id or ""
            if not preset_id:
                continue
            stats[preset_id] = {
                "presetLabel": row.preset_label or preset_id,
                "cta": int(row.cta_count or 0),
                "configurator": int(row.config_apply_count or 0),
                "clears": int(row.clear_count or 0),
            }
        return stats

    async def _fetch_source_stats(self, start_dt: datetime, end_dt: datetime) -> Dict[str, Dict[str, Any]]:
        conditions = [
            CheckoutOfferEvent.created_at >= start_dt,
            CheckoutOfferEvent.created_at < end_dt,
            CheckoutOfferEvent.event_type.in_(PRESET_EVENT_TYPES),
        ]

        cta_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_cta_apply", 1), else_=0)
        ).label("cta_count")
        config_apply_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_configurator_apply", 1), else_=0)
        ).label("config_apply_count")
        clears_case = func.sum(
            case((CheckoutOfferEvent.event_type == "preset_configurator_clear", 1), else_=0)
        ).label("clear_count")

        source_stmt = (
            select(
                func.coalesce(CheckoutOfferEvent.metadata_json["source"].astext, "unknown").label("source"),
                cta_case,
                config_apply_case,
                clears_case,
            )
            .where(*conditions)
            .group_by("source")
        )
        source_result = await self._session.execute(source_stmt)
        rows = source_result.all()
        stats: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            key = row.source or "unknown"
            stats[key] = {
                "cta": int(row.cta_count or 0),
                "configurator": int(row.config_apply_count or 0),
                "clears": int(row.clear_count or 0),
            }
        return stats

    @staticmethod
    def _build_window_stat(stats: Mapping[str, Any] | None) -> Dict[str, Any]:
        stats = stats or {}
        cta = int(stats.get("cta", 0))
        configurator = int(stats.get("configurator", 0))
        clears = int(stats.get("clears", 0))
        applies = cta + configurator
        net = applies - clears
        clear_rate = clears / max(applies, 1) if applies else 0.0
        return {
            "applies": applies,
            "clears": clears,
            "net": net,
            "clearRate": clear_rate,
        }

    def _evaluate_alerts(
        self,
        metrics: List[PresetEventDailyMetric],
        *,
        breakdowns: Dict[str, Any] | None = None,
    ) -> List[Dict[str, Any]]:
        if not metrics:
            return []

        alert_window_days = min(7, len(metrics))
        recent_metrics = metrics[-alert_window_days:]
        total_cta = sum(metric.preset_cta_apply_count for metric in recent_metrics)
        total_config_apply = sum(metric.preset_configurator_apply_count for metric in recent_metrics)
        total_clears = sum(metric.preset_configurator_clear_count for metric in recent_metrics)
        total_applies = total_cta + total_config_apply

        alerts: List[Dict[str, Any]] = []
        if total_applies >= 10:
            clear_ratio = total_clears / max(total_applies, 1)
            if clear_ratio >= 0.4:
                alerts.append(
                    {
                        "code": "high_clear_rate",
                        "severity": "warn",
                        "message": f"Preset clears reached {clear_ratio:.0%} of applies over the last {alert_window_days} days.",
                        "metrics": {
                            "clears": total_clears,
                            "applies": total_applies,
                            "windowDays": alert_window_days,
                        },
                    }
                )

        consecutive_negative = 0
        for metric in reversed(metrics):
            applies = (metric.preset_cta_apply_count or 0) + (metric.preset_configurator_apply_count or 0)
            clears = metric.preset_configurator_clear_count or 0
            net = applies - clears
            if applies + clears == 0:
                continue
            if net <= 0:
                consecutive_negative += 1
            else:
                break
        if consecutive_negative >= 3:
            alerts.append(
                {
                    "code": "negative_preset_trend",
                    "severity": "warn",
                    "message": f"Preset applies trailed clears for {consecutive_negative} consecutive days.",
                    "metrics": {
                        "consecutiveDays": consecutive_negative,
                    },
                }
            )

        if breakdowns:
            preset_breakdowns: List[Dict[str, Any]] = breakdowns.get("presets", [])
            risky_presets = [
                entry for entry in preset_breakdowns if entry.get("isRisky") and entry.get("applies", 0) >= 10
            ]
            if risky_presets:
                risky_presets.sort(key=lambda entry: entry.get("clearRate", 0), reverse=True)
                alerts.append(
                    {
                        "code": "preset_specific_clear_rate",
                        "severity": "warn",
                        "message": "Some presets show sustained high clear rates.",
                        "metrics": {
                            "presets": [
                                {
                                    "presetId": entry["presetId"],
                                    "clearRate": entry.get("clearRate", 0),
                                    "applies": entry.get("applies", 0),
                                    "clears": entry.get("clears", 0),
                                }
                                for entry in risky_presets[:3]
                            ]
                        },
                    }
                )
            degrading_presets = []
            for entry in preset_breakdowns:
                windows = entry.get("windows") or {}
                short_window = windows.get("short")
                long_window = windows.get("long")
                if not short_window or not long_window:
                    continue
                short_clear = short_window.get("clearRate", 0.0)
                long_clear = long_window.get("clearRate", 0.0)
                if short_window.get("applies", 0) < 5:
                    continue
                if short_clear - long_clear >= 0.15 and short_clear >= 0.35:
                    degrading_presets.append(
                        {
                            "presetId": entry["presetId"],
                            "shortClearRate": short_clear,
                            "longClearRate": long_clear,
                            "shortApplies": short_window.get("applies", 0),
                        }
                    )
            if degrading_presets:
                degrading_presets.sort(key=lambda item: item["shortClearRate"], reverse=True)
                alerts.append(
                    {
                        "code": "preset_clear_rate_regression",
                        "severity": "warn",
                        "message": "Short-term clear rates spiked vs long-term baseline.",
                        "metrics": {"presets": degrading_presets[:3]},
                    }
                )

        return alerts


__all__ = [
    "PresetEventAnalyticsService",
    "PresetEventDailyMetricService",
    "PRESET_EVENT_TYPES",
]
