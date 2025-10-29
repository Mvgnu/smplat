"""Authentication hardening endpoints."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from smplat_api.services.auth import AuthLockoutState, LockoutService

router = APIRouter(prefix="/auth", tags=["Auth"])


def _hash_identifier(identifier: str) -> str:
    # security-lockout: hashed-identifier
    digest = hashlib.sha256()
    digest.update(identifier.strip().lower().encode("utf-8"))
    return digest.hexdigest()


class AuthAttemptRequest(BaseModel):
    """Payload describing the result of an authentication attempt."""

    identifier: str = Field(..., description="User identifier (email or username)")
    outcome: str = Field(..., description="Outcome of the authentication attempt (success|failure)")

    def normalized_identifier(self) -> str:
        return _hash_identifier(self.identifier)

    def validate_outcome(self) -> None:
        if self.outcome not in {"success", "failure"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid outcome")


class AuthAttemptResponse(BaseModel):
    """Lockout state returned to clients."""

    locked: bool = Field(..., description="Whether the identifier is currently locked")
    retry_after_seconds: int | None = Field(
        default=None, description="Seconds until attempts can resume if locked"
    )
    remaining_attempts: int = Field(
        ..., description="Attempts remaining before lockout activates"
    )


async def get_lockout_service() -> LockoutService:
    return LockoutService()


@router.post("/attempts", response_model=AuthAttemptResponse, status_code=status.HTTP_200_OK)
async def track_auth_attempt(
    payload: AuthAttemptRequest, service: LockoutService = Depends(get_lockout_service)
) -> AuthAttemptResponse:
    """Register an authentication attempt and return the lockout state."""

    payload.validate_outcome()
    identifier = payload.normalized_identifier()

    state: AuthLockoutState
    if payload.outcome == "failure":
        state = await service.register_failure(identifier)
    else:
        state = await service.register_success(identifier)

    return AuthAttemptResponse(
        locked=state.locked,
        retry_after_seconds=state.retry_after_seconds,
        remaining_attempts=state.remaining_attempts,
    )


@router.get("/lockout", response_model=AuthAttemptResponse, status_code=status.HTTP_200_OK)
async def get_auth_lockout_state(
    identifier: str, service: LockoutService = Depends(get_lockout_service)
) -> AuthAttemptResponse:
    """Return the current lockout state without mutating counters."""

    hashed = _hash_identifier(identifier)
    state = await service.get_state(hashed)
    return AuthAttemptResponse(
        locked=state.locked,
        retry_after_seconds=state.retry_after_seconds,
        remaining_attempts=state.remaining_attempts,
    )
