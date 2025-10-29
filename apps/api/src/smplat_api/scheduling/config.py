"""Configuration loader for recurring job schedules."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import tomllib


@dataclass(slots=True)
class JobDefinition:
    """Describe a scheduled job."""

    id: str
    task: str
    cron: str
    kwargs: dict[str, Any] = field(default_factory=dict)
    max_attempts: int = 1
    base_backoff_seconds: float = 5.0
    backoff_multiplier: float = 2.0
    max_backoff_seconds: float = 60.0
    jitter_seconds: float = 1.0


@dataclass(slots=True)
class ScheduleConfig:
    """Root schedule configuration."""

    timezone: str
    jobs: list[JobDefinition]


def load_job_definitions(config_path: Path) -> ScheduleConfig:
    """Load job definitions from a TOML schedule file."""

    if not config_path.exists():
        raise FileNotFoundError(f"Schedule config not found: {config_path}")

    data = tomllib.loads(config_path.read_text())
    timezone = data.get("timezone", "UTC")
    job_entries = data.get("jobs", {})
    jobs: list[JobDefinition] = []
    for key, payload in job_entries.items():
        if not isinstance(payload, dict):
            continue
        job_id = payload.get("id") or key
        task = payload.get("task")
        cron = payload.get("cron")
        kwargs = payload.get("kwargs", {})
        if not isinstance(task, str) or not isinstance(cron, str):
            continue
        if not isinstance(kwargs, dict):
            kwargs = {}

        max_attempts = int(payload.get("max_attempts", 1) or 1)
        base_backoff_seconds = float(payload.get("base_backoff_seconds", 5.0) or 0)
        backoff_multiplier = float(payload.get("backoff_multiplier", 2.0) or 1)
        max_backoff_seconds = float(payload.get("max_backoff_seconds", 60.0) or 0)
        jitter_seconds = float(payload.get("jitter_seconds", 1.0) or 0)

        jobs.append(
            JobDefinition(
                id=str(job_id),
                task=task,
                cron=cron,
                kwargs=kwargs,
                max_attempts=max(max_attempts, 1),
                base_backoff_seconds=max(base_backoff_seconds, 0.0),
                backoff_multiplier=max(backoff_multiplier, 1.0),
                max_backoff_seconds=max(max_backoff_seconds, 0.0),
                jitter_seconds=max(jitter_seconds, 0.0),
            )
        )

    return ScheduleConfig(timezone=str(timezone), jobs=jobs)


__all__ = ["JobDefinition", "ScheduleConfig", "load_job_definitions"]
