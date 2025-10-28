from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from smplat_api.services.secrets.stripe import StripeWorkspaceSecrets, StripeWorkspaceSecretsResolver


class StubSecretSource:
    def __init__(self, *, expires_at: datetime | None = None) -> None:
        self.calls: list[UUID | None] = []
        self._expires_at = expires_at

    async def fetch(self, workspace_id: UUID | None):
        self.calls.append(workspace_id)
        if workspace_id is None:
            return None
        return StripeWorkspaceSecrets(
            api_key="sk_test_stub",
            webhook_secret="whsec_stub",
            refreshed_at=datetime.now(timezone.utc),
            expires_at=self._expires_at,
        )


@pytest.mark.asyncio
async def test_resolver_caches_until_expiration() -> None:
    workspace_id = uuid4()
    source = StubSecretSource()
    resolver = StripeWorkspaceSecretsResolver(source, cache_ttl=timedelta(seconds=60))

    first = await resolver.get(workspace_id)
    second = await resolver.get(workspace_id)

    assert first is second
    assert source.calls == [workspace_id]


@pytest.mark.asyncio
async def test_resolver_refreshes_when_expired() -> None:
    workspace_id = uuid4()
    source = StubSecretSource(expires_at=datetime.now(timezone.utc))
    resolver = StripeWorkspaceSecretsResolver(source, cache_ttl=timedelta(seconds=0))

    first = await resolver.get(workspace_id)
    second = await resolver.get(workspace_id)

    assert first is not second
    assert len(source.calls) == 2
