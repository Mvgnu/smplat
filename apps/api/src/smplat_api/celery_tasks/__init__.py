"""Celery task modules for SMPLAT."""

# Import submodules so Celery autodiscovery registers tasks.
from . import provider_automation as _provider_automation  # noqa: F401
from . import journey_runtime as _journey_runtime  # noqa: F401

__all__ = ["_provider_automation", "_journey_runtime"]
