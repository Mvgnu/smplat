"""Brute force lockout tracking using Redis counters."""

from __future__ import annotations

from dataclasses import dataclass

from redis.asyncio import Redis

from smplat_api.core.settings import settings


@dataclass
class AuthLockoutState:
    """Represents the lockout state for a subject."""

    locked: bool
    retry_after_seconds: int | None
    remaining_attempts: int


class LockoutService:
    """Service managing lockout counters for authentication flows."""

    def __init__(
        self,
        redis_client: Redis | None = None,
        *,
        threshold: int | None = None,
        window_seconds: int | None = None,
        lockout_seconds: int | None = None,
    ) -> None:
        self._redis = redis_client or Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        self._threshold = threshold or settings.auth_lockout_threshold
        self._window_seconds = window_seconds or settings.auth_lockout_window_seconds
        self._lockout_seconds = lockout_seconds or settings.auth_lockout_duration_seconds

    @staticmethod
    def _attempts_key(identifier: str) -> str:
        return f"auth:attempts:{identifier}"

    @staticmethod
    def _lock_key(identifier: str) -> str:
        return f"auth:lock:{identifier}"

    async def get_state(self, identifier: str) -> AuthLockoutState:
        """Retrieve the current lockout state for the identifier."""

        lock_ttl = await self._redis.ttl(self._lock_key(identifier))
        if lock_ttl and lock_ttl > 0:
            return AuthLockoutState(locked=True, retry_after_seconds=lock_ttl, remaining_attempts=0)

        attempts_key = self._attempts_key(identifier)
        attempts_raw = await self._redis.get(attempts_key)
        attempts = int(attempts_raw) if attempts_raw is not None else 0
        remaining = max(self._threshold - attempts, 0)
        return AuthLockoutState(locked=False, retry_after_seconds=None, remaining_attempts=remaining)

    async def register_failure(self, identifier: str) -> AuthLockoutState:
        """Record a failed login attempt and compute the new lockout state."""

        # security-lockout: login-failure-tracking
        lock_key = self._lock_key(identifier)
        lock_ttl = await self._redis.ttl(lock_key)
        if lock_ttl and lock_ttl > 0:
            return AuthLockoutState(locked=True, retry_after_seconds=lock_ttl, remaining_attempts=0)

        attempts_key = self._attempts_key(identifier)
        attempts = await self._redis.incr(attempts_key)
        if attempts == 1:
            await self._redis.expire(attempts_key, self._window_seconds)

        if attempts >= self._threshold:
            await self._redis.delete(attempts_key)
            await self._redis.set(lock_key, "1", ex=self._lockout_seconds)
            lock_ttl = await self._redis.ttl(lock_key)
            return AuthLockoutState(locked=True, retry_after_seconds=lock_ttl, remaining_attempts=0)

        remaining = max(self._threshold - attempts, 0)
        return AuthLockoutState(locked=False, retry_after_seconds=None, remaining_attempts=remaining)

    async def register_success(self, identifier: str) -> AuthLockoutState:
        """Reset counters after a successful authentication."""

        await self._redis.delete(self._attempts_key(identifier))
        await self._redis.delete(self._lock_key(identifier))
        return AuthLockoutState(locked=False, retry_after_seconds=None, remaining_attempts=self._threshold)

