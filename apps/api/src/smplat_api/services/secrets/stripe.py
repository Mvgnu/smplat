"""Workspace-scoped Stripe credential resolution utilities."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Mapping, MutableMapping, Protocol, Sequence
from uuid import UUID

import httpx
from loguru import logger

from smplat_api.core.settings import settings


class VaultRequestError(RuntimeError):
    """Raised when Vault returns an unexpected response."""


class VaultClientProtocol(Protocol):
    """Protocol describing the subset of Vault client interactions we require."""

    async def read_secret(self, path: str) -> Mapping[str, Any] | None:
        """Retrieve a secret from Vault, returning ``None`` when it is missing."""


class HttpVaultClient(VaultClientProtocol):
    """Minimal Vault client backed by ``httpx`` for KV v2 secret retrieval."""

    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        namespace: str | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        if not base_url:
            raise ValueError("Vault base URL must be configured")
        if not token:
            raise ValueError("Vault token must be configured")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._namespace = namespace
        self._timeout_seconds = timeout_seconds

    async def read_secret(self, path: str) -> Mapping[str, Any] | None:  # pragma: no cover - thin HTTP wrapper
        url = f"{self._base_url}/v1/{path.lstrip('/')}"
        headers = {"X-Vault-Token": self._token}
        if self._namespace:
            headers["X-Vault-Namespace"] = self._namespace
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.get(url)
        if response.status_code == 200:
            return response.json()
        if response.status_code in (204, 404):
            return None
        raise VaultRequestError(
            f"Vault responded with unexpected status {response.status_code} for path '{path}'"
        )


@dataclass(slots=True)
class StripeWorkspaceSecrets:
    """Resolved Stripe credential bundle for a specific workspace."""

    api_key: str
    webhook_secret: str | None
    refreshed_at: datetime
    expires_at: datetime | None = None


class StripeSecretSource(Protocol):
    """Protocol for implementations capable of fetching workspace credentials."""

    async def fetch(self, workspace_id: UUID | None) -> StripeWorkspaceSecrets | None:
        """Return credentials for the workspace or ``None`` when unavailable."""


@dataclass(slots=True)
class _CacheEntry:
    secrets: StripeWorkspaceSecrets
    expires_at: datetime

    def is_valid(self, now: datetime) -> bool:
        return now < self.expires_at


class StripeWorkspaceSecretsResolver:
    """Caches and resolves workspace-specific Stripe credentials."""

    def __init__(
        self,
        source: StripeSecretSource,
        *,
        cache_ttl: timedelta | None = None,
    ) -> None:
        self._source = source
        self._cache_ttl = cache_ttl or timedelta(seconds=settings.stripe_secret_cache_ttl_seconds)
        self._cache: MutableMapping[UUID | None, _CacheEntry] = {}
        self._locks: MutableMapping[UUID | None, asyncio.Lock] = {}

    async def get(self, workspace_id: UUID | None) -> StripeWorkspaceSecrets | None:
        """Return credentials for the workspace, refreshing cache entries as needed."""

        now = datetime.now(timezone.utc)
        cached = self._cache.get(workspace_id)
        if cached and cached.is_valid(now):
            return cached.secrets

        lock = self._locks.setdefault(workspace_id, asyncio.Lock())
        async with lock:
            cached = self._cache.get(workspace_id)
            if cached and cached.is_valid(datetime.now(timezone.utc)):
                return cached.secrets

            secrets = await self._source.fetch(workspace_id)
            if secrets is None:
                self._cache.pop(workspace_id, None)
                return None

            expires_at = secrets.expires_at or (datetime.now(timezone.utc) + self._cache_ttl)
            if secrets.expires_at and secrets.expires_at - datetime.now(timezone.utc) > self._cache_ttl:
                expires_at = datetime.now(timezone.utc) + self._cache_ttl
            self._cache[workspace_id] = _CacheEntry(secrets=secrets, expires_at=expires_at)
            return secrets

    def invalidate(self, workspace_id: UUID | None = None) -> None:
        """Invalidate cached credentials for a workspace or the entire cache when ``None``."""

        if workspace_id is None:
            self._cache.clear()
            return
        self._cache.pop(workspace_id, None)


class VaultStripeSecretSource(StripeSecretSource):
    """Retrieve Stripe credentials from a Vault KV v2 secret."""

    def __init__(
        self,
        client: VaultClientProtocol,
        *,
        mount_path: str,
    ) -> None:
        self._client = client
        self._mount_path = mount_path.rstrip("/")

    async def fetch(self, workspace_id: UUID | None) -> StripeWorkspaceSecrets | None:
        if workspace_id is None:
            return None
        path = f"{self._mount_path}/{workspace_id}"
        try:
            payload = await self._client.read_secret(path)
        except VaultRequestError:
            logger.exception("vault.stripe.read_failed", workspace_id=str(workspace_id))
            return None
        if not payload:
            return None

        data = payload.get("data") or {}
        if "data" in data:
            data = data["data"] or {}
        api_key = data.get("api_key")
        webhook_secret = data.get("webhook_secret")
        if not api_key:
            logger.warning("vault.stripe.missing_api_key", workspace_id=str(workspace_id))
            return None

        rotation_hint = data.get("rotation_expires_at")
        expires_at: datetime | None = None
        if rotation_hint:
            try:
                expires_at = datetime.fromisoformat(rotation_hint)
            except ValueError:
                logger.warning(
                    "vault.stripe.invalid_rotation_hint",
                    workspace_id=str(workspace_id),
                    rotation_expires_at=rotation_hint,
                )
        return StripeWorkspaceSecrets(
            api_key=str(api_key),
            webhook_secret=str(webhook_secret) if webhook_secret else None,
            refreshed_at=datetime.now(timezone.utc),
            expires_at=expires_at,
        )


class SettingsStripeSecretSource(StripeSecretSource):
    """Fallback secret source that returns globally configured credentials."""

    async def fetch(self, workspace_id: UUID | None) -> StripeWorkspaceSecrets | None:
        if not settings.stripe_secret_key:
            return None
        return StripeWorkspaceSecrets(
            api_key=settings.stripe_secret_key,
            webhook_secret=settings.stripe_webhook_secret or None,
            refreshed_at=datetime.now(timezone.utc),
            expires_at=None,
        )


class CompositeStripeSecretSource(StripeSecretSource):
    """Attempts multiple secret sources in sequence until one returns credentials."""

    def __init__(self, sources: Sequence[StripeSecretSource]) -> None:
        self._sources = list(sources)

    async def fetch(self, workspace_id: UUID | None) -> StripeWorkspaceSecrets | None:
        for source in self._sources:
            secrets = await source.fetch(workspace_id)
            if secrets is not None:
                return secrets
        return None


def build_default_stripe_secret_source() -> StripeSecretSource:
    """Construct the default secret source hierarchy."""

    sources: list[StripeSecretSource] = []
    if settings.vault_addr and settings.vault_token and settings.vault_stripe_mount_path:
        client = HttpVaultClient(
            base_url=settings.vault_addr,
            token=settings.vault_token,
            namespace=settings.vault_namespace,
            timeout_seconds=settings.vault_timeout_seconds,
        )
        sources.append(
            VaultStripeSecretSource(
                client,
                mount_path=settings.vault_stripe_mount_path,
            )
        )
    sources.append(SettingsStripeSecretSource())
    return CompositeStripeSecretSource(sources)


@lru_cache(maxsize=1)
def build_default_stripe_secrets_resolver() -> StripeWorkspaceSecretsResolver:
    """Factory that wires the resolver with the configured secret sources."""

    return StripeWorkspaceSecretsResolver(build_default_stripe_secret_source())


__all__ = [
    "CompositeStripeSecretSource",
    "HttpVaultClient",
    "StripeWorkspaceSecrets",
    "StripeWorkspaceSecretsResolver",
    "StripeSecretSource",
    "VaultClientProtocol",
    "VaultRequestError",
    "VaultStripeSecretSource",
    "build_default_stripe_secret_source",
    "build_default_stripe_secrets_resolver",
]
