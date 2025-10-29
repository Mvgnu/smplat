"""Observability store for catalog job scheduler metrics."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Dict


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SchedulerJobSnapshot:
    """Serializable snapshot of a scheduled job."""

    job_id: str
    task: str
    totals: Dict[str, int]
    timings: Dict[str, float]
    last_started_at: datetime | None
    last_completed_at: datetime | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error: str | None
    last_attempts: int
    last_retry_delay_seconds: float | None

    def as_dict(self) -> Dict[str, object]:
        return {
            "job_id": self.job_id,
            "task": self.task,
            "totals": self.totals,
            "timings": self.timings,
            "last_started_at": self.last_started_at.isoformat() if self.last_started_at else None,
            "last_completed_at": self.last_completed_at.isoformat() if self.last_completed_at else None,
            "last_success_at": self.last_success_at.isoformat() if self.last_success_at else None,
            "last_error_at": self.last_error_at.isoformat() if self.last_error_at else None,
            "last_error": self.last_error,
            "last_attempts": self.last_attempts,
            "last_retry_delay_seconds": self.last_retry_delay_seconds,
        }


@dataclass
class SchedulerSnapshot:
    """Snapshot across all catalog scheduler jobs."""

    totals: Dict[str, int]
    jobs: Dict[str, SchedulerJobSnapshot]

    def as_dict(self) -> Dict[str, object]:
        return {
            "totals": self.totals,
            "jobs": {job_id: snapshot.as_dict() for job_id, snapshot in self.jobs.items()},
        }


@dataclass
class SchedulerJobState:
    job_id: str
    task: str
    total_runs: int = 0
    total_success: int = 0
    total_run_failures: int = 0
    total_attempt_failures: int = 0
    total_retries: int = 0
    total_runtime_seconds: float = 0.0
    last_started_at: datetime | None = None
    last_completed_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error: str | None = None
    last_attempts: int = 0
    last_retry_delay_seconds: float | None = None
    consecutive_failures: int = 0

    def snapshot(self) -> SchedulerJobSnapshot:
        return SchedulerJobSnapshot(
            job_id=self.job_id,
            task=self.task,
            totals={
                "runs": self.total_runs,
                "success": self.total_success,
                "run_failures": self.total_run_failures,
                "attempt_failures": self.total_attempt_failures,
                "retries": self.total_retries,
                "consecutive_failures": self.consecutive_failures,
            },
            timings={
                "total_runtime_seconds": self.total_runtime_seconds,
            },
            last_started_at=self.last_started_at,
            last_completed_at=self.last_completed_at,
            last_success_at=self.last_success_at,
            last_error_at=self.last_error_at,
            last_error=self.last_error,
            last_attempts=self.last_attempts,
            last_retry_delay_seconds=self.last_retry_delay_seconds,
        )


class CatalogSchedulerObservabilityStore:
    """Tracks catalog scheduler dispatch metrics."""

    # meta: observability: catalog-scheduler

    def __init__(self) -> None:
        self._lock: Lock = Lock()
        self._jobs: Dict[str, SchedulerJobState] = {}

    def reset(self) -> None:
        with self._lock:
            self._jobs.clear()

    def _get_state(self, job_id: str, task: str) -> SchedulerJobState:
        state = self._jobs.get(job_id)
        if state is None:
            state = SchedulerJobState(job_id=job_id, task=task)
            self._jobs[job_id] = state
        else:
            state.task = task
        return state

    def record_dispatch(self, job_id: str, task: str) -> None:
        with self._lock:
            state = self._get_state(job_id, task)
            state.total_runs += 1
            state.last_started_at = _utcnow()
            state.last_completed_at = None
            state.last_attempts = 0
            state.last_retry_delay_seconds = None

    def record_attempt_failure(self, job_id: str, task: str, *, attempts: int, error: str) -> None:
        with self._lock:
            state = self._get_state(job_id, task)
            state.total_attempt_failures += 1
            state.last_error = error
            state.last_error_at = _utcnow()
            state.last_attempts = attempts
            state.consecutive_failures += 1

    def record_retry(self, job_id: str, task: str, *, delay_seconds: float, attempts: int) -> None:
        with self._lock:
            state = self._get_state(job_id, task)
            state.total_retries += 1
            state.last_retry_delay_seconds = delay_seconds
            state.last_attempts = attempts

    def record_success(self, job_id: str, task: str, *, runtime_seconds: float, attempts: int) -> None:
        with self._lock:
            state = self._get_state(job_id, task)
            state.total_success += 1
            state.total_runtime_seconds += runtime_seconds
            state.last_completed_at = _utcnow()
            state.last_success_at = state.last_completed_at
            state.last_attempts = attempts
            state.consecutive_failures = 0
            state.last_error = None
            state.last_error_at = None

    def record_run_failure(self, job_id: str, task: str, *, runtime_seconds: float, attempts: int, error: str) -> None:
        with self._lock:
            state = self._get_state(job_id, task)
            state.total_run_failures += 1
            state.total_runtime_seconds += runtime_seconds
            state.last_completed_at = _utcnow()
            state.last_error = error
            state.last_error_at = state.last_completed_at
            state.last_attempts = attempts

    def snapshot(self) -> SchedulerSnapshot:
        with self._lock:
            jobs = {job_id: state.snapshot() for job_id, state in self._jobs.items()}
            totals = {
                "runs": sum(state.total_runs for state in self._jobs.values()),
                "success": sum(state.total_success for state in self._jobs.values()),
                "run_failures": sum(state.total_run_failures for state in self._jobs.values()),
                "attempt_failures": sum(state.total_attempt_failures for state in self._jobs.values()),
                "retries": sum(state.total_retries for state in self._jobs.values()),
            }
        return SchedulerSnapshot(totals=totals, jobs=jobs)


_SCHEDULER_STORE = CatalogSchedulerObservabilityStore()


def get_catalog_scheduler_store() -> CatalogSchedulerObservabilityStore:
    return _SCHEDULER_STORE


__all__ = [
    "CatalogSchedulerObservabilityStore",
    "SchedulerSnapshot",
    "get_catalog_scheduler_store",
]
