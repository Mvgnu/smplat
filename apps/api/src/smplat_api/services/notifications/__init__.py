"""Notification service package."""

from .backend import (
    EmailBackend,
    SMTPEmailBackend,
    InMemoryEmailBackend,
    SMSBackend,
    PushBackend,
    InMemorySMSBackend,
    InMemoryPushBackend,
)
from .digest_dispatcher import WeeklyDigestDispatcher
from .digest_scheduler import WeeklyDigestScheduler
from .service import NotificationService, NotificationEvent

__all__ = [
    "EmailBackend",
    "SMTPEmailBackend",
    "InMemoryEmailBackend",
    "SMSBackend",
    "PushBackend",
    "InMemorySMSBackend",
    "InMemoryPushBackend",
    "NotificationService",
    "NotificationEvent",
    "WeeklyDigestDispatcher",
    "WeeklyDigestScheduler",
]
