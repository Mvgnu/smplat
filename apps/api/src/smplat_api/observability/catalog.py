"""In-memory observability helpers for catalog search interactions."""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Deque, Dict, Tuple


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CatalogSearchEventLog:
    last_query: str | None = None
    last_category: str | None = None
    last_sort: str | None = None
    last_results_count: int | None = None
    last_search_at: datetime | None = None
    recent: Deque[Tuple[str | None, str | None, str | None, int, datetime]] = field(
        default_factory=lambda: deque(maxlen=25)
    )


@dataclass
class CatalogSearchSnapshot:
    totals: Dict[str, int]
    categories: Dict[str, int]
    sorts: Dict[str, int]
    queries: Dict[str, int]
    zero_result_queries: Dict[str, int]
    metrics: Dict[str, float]
    events: CatalogSearchEventLog

    def as_dict(self) -> Dict[str, object]:
        return {
            "totals": self.totals,
            "categories": self.categories,
            "sorts": self.sorts,
            "queries": self.queries,
            "zero_result_queries": self.zero_result_queries,
            "metrics": self.metrics,
            "events": {
                "last_query": self.events.last_query,
                "last_category": self.events.last_category,
                "last_sort": self.events.last_sort,
                "last_results_count": self.events.last_results_count,
                "last_search_at": self.events.last_search_at.isoformat()
                if self.events.last_search_at
                else None,
                "recent": [
                    {
                        "query": query,
                        "category": category,
                        "sort": sort,
                        "results_count": results_count,
                        "recorded_at": timestamp.isoformat(),
                    }
                    for query, category, sort, results_count, timestamp in self.events.recent
                ],
            },
        }


@dataclass
class CatalogSearchObservabilityStore:
    _lock: Lock = field(default_factory=Lock)
    _totals: Counter = field(default_factory=Counter)
    _categories: Counter = field(default_factory=Counter)
    _sorts: Counter = field(default_factory=Counter)
    _queries: Counter = field(default_factory=Counter)
    _zero_result_queries: Counter = field(default_factory=Counter)
    _events: CatalogSearchEventLog = field(default_factory=CatalogSearchEventLog)

    def record_search(
        self,
        query: str | None,
        category: str | None,
        sort: str,
        results_count: int,
    ) -> None:
        canonical_sort = sort or "featured"
        canonical_category = (category or "all").lower()
        normalized_query = (query or "").strip().lower()

        with self._lock:
            self._totals["searches"] += 1
            self._totals["results_returned"] += results_count
            if results_count == 0:
                self._totals["zero_results"] += 1
                if normalized_query:
                    self._zero_result_queries[normalized_query] += 1
            self._categories[canonical_category] += 1
            self._sorts[canonical_sort] += 1
            if normalized_query:
                self._queries[normalized_query] += 1

            timestamp = _utcnow()
            self._events.last_query = normalized_query or None
            self._events.last_category = canonical_category
            self._events.last_sort = canonical_sort
            self._events.last_results_count = results_count
            self._events.last_search_at = timestamp
            self._events.recent.appendleft(
                (self._events.last_query, canonical_category, canonical_sort, results_count, timestamp)
            )

    def snapshot(self) -> CatalogSearchSnapshot:
        with self._lock:
            totals = dict(self._totals)
            totals.setdefault("searches", 0)
            totals.setdefault("results_returned", 0)
            totals.setdefault("zero_results", 0)
            categories = dict(self._categories.most_common(10))
            sorts = dict(self._sorts)
            queries = dict(self._queries.most_common(10))
            zero_result_queries = dict(self._zero_result_queries.most_common(10))
            searches = totals.get("searches", 0)
            zero_results = totals.get("zero_results", 0)
            results_returned = totals.get("results_returned", 0)
            metrics = {
                "zero_results_rate": (zero_results / searches) if searches else 0.0,
                "average_results_per_search": (results_returned / searches) if searches else 0.0,
            }
            events = CatalogSearchEventLog(
                last_query=self._events.last_query,
                last_category=self._events.last_category,
                last_sort=self._events.last_sort,
                last_results_count=self._events.last_results_count,
                last_search_at=self._events.last_search_at,
                recent=deque(self._events.recent, maxlen=self._events.recent.maxlen),
            )
        return CatalogSearchSnapshot(
            totals=totals,
            categories=categories,
            sorts=sorts,
            queries=queries,
            zero_result_queries=zero_result_queries,
            metrics=metrics,
            events=events,
        )

    def reset(self) -> None:
        with self._lock:
            self._totals.clear()
            self._categories.clear()
            self._sorts.clear()
            self._queries.clear()
            self._zero_result_queries.clear()
            self._events = CatalogSearchEventLog()


_CATALOG_STORE = CatalogSearchObservabilityStore()


def get_catalog_store() -> CatalogSearchObservabilityStore:
    return _CATALOG_STORE
