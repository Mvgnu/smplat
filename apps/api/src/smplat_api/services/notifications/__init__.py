"""Notification service package."""

from .backend import EmailBackend, SMTPEmailBackend, InMemoryEmailBackend
from .digest_dispatcher import WeeklyDigestDispatcher
from .digest_scheduler import WeeklyDigestScheduler
from .service import NotificationService, NotificationEvent

__all__ = [
    "EmailBackend",
    "SMTPEmailBackend",
    "InMemoryEmailBackend",
    "NotificationService",
    "NotificationEvent",
    "WeeklyDigestDispatcher",
    "WeeklyDigestScheduler",
]
