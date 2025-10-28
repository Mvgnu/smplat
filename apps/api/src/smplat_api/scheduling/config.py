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
        jobs.append(JobDefinition(id=str(job_id), task=task, cron=cron, kwargs=kwargs))

    return ScheduleConfig(timezone=str(timezone), jobs=jobs)


__all__ = ["JobDefinition", "ScheduleConfig", "load_job_definitions"]
