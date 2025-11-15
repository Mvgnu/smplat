"""Authentication hardening endpoints."""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status, Query
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from smplat_api.db.session import get_session
from smplat_api.models import AuthAccount, AuthSession, AuthVerificationToken, User
from smplat_api.models.user import UserRoleEnum, UserStatusEnum
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


class AuthUserCreateRequest(BaseModel):
    email: str
    display_name: str | None = None
    email_verified_at: datetime | None = None
    role: UserRoleEnum = UserRoleEnum.CLIENT
    status: UserStatusEnum = UserStatusEnum.ACTIVE

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise ValueError("Invalid email address")
        return email


class AuthUserUpdateRequest(BaseModel):
    display_name: str | None = None
    email_verified_at: datetime | None = None
    is_email_verified: bool | None = None
    role: UserRoleEnum | None = None
    status: UserStatusEnum | None = None

    model_config = ConfigDict(extra="forbid")


class AuthUserResponse(BaseModel):
    id: UUID
    email: str
    display_name: str | None
    role: UserRoleEnum
    status: UserStatusEnum
    email_verified_at: datetime | None
    is_email_verified: bool

    model_config = ConfigDict(from_attributes=True)


class AuthAccountCreateRequest(BaseModel):
    user_id: UUID
    type: str
    provider: str
    provider_account_id: str
    refresh_token: str | None = None
    access_token: str | None = None
    expires_at: int | None = None
    token_type: str | None = None
    scope: str | None = None
    id_token: str | None = None
    session_state: str | None = None

    model_config = ConfigDict(extra="forbid")


class AuthAccountResponse(BaseModel):
    id: UUID
    user_id: UUID
    type: str
    provider: str
    provider_account_id: str
    refresh_token: str | None
    access_token: str | None
    expires_at: int | None
    token_type: str | None
    scope: str | None
    id_token: str | None
    session_state: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthAccountDeleteRequest(BaseModel):
    provider: str
    provider_account_id: str

    model_config = ConfigDict(extra="forbid")


class AuthAccountWithUserResponse(BaseModel):
    account: AuthAccountResponse
    user: AuthUserResponse


class AuthSessionCreateRequest(BaseModel):
    session_token: str
    user_id: UUID
    expires: datetime
    role_snapshot: UserRoleEnum | None = None
    permissions: list[str] | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    device_fingerprint: str | None = None

    model_config = ConfigDict(extra="forbid")


class AuthSessionUpdateRequest(BaseModel):
    expires: datetime | None = None
    role_snapshot: UserRoleEnum | None = None
    permissions: list[str] | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    device_fingerprint: str | None = None

    model_config = ConfigDict(extra="forbid")


class AuthSessionResponse(BaseModel):
    id: UUID
    session_token: str
    user_id: UUID
    expires: datetime
    role_snapshot: UserRoleEnum | None
    permissions: list[str]
    ip_address: str | None
    user_agent: str | None
    device_fingerprint: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthSessionWithUserResponse(BaseModel):
    session: AuthSessionResponse
    user: AuthUserResponse


class AuthVerificationTokenCreateRequest(BaseModel):
    identifier: str
    token: str
    expires: datetime

    model_config = ConfigDict(extra="forbid")


class AuthVerificationTokenUseRequest(BaseModel):
    identifier: str
    token: str

    model_config = ConfigDict(extra="forbid")


class AuthVerificationTokenResponse(BaseModel):
    identifier: str
    token: str
    expires: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


async def get_lockout_service() -> LockoutService:
    return LockoutService()


def _normalize_permissions(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(scope) for scope in value]
    return []


def _normalize_email_for_query(value: str) -> str:
    email = value.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid email")
    return email


def _user_to_response(user: User) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        status=user.status,
        email_verified_at=user.email_verified_at,
        is_email_verified=user.is_email_verified,
    )


def _account_to_response(account: AuthAccount) -> AuthAccountResponse:
    return AuthAccountResponse(
        id=account.id,
        user_id=account.user_id,
        type=account.type,
        provider=account.provider,
        provider_account_id=account.provider_account_id,
        refresh_token=account.refresh_token,
        access_token=account.access_token,
        expires_at=account.expires_at,
        token_type=account.token_type,
        scope=account.scope,
        id_token=account.id_token,
        session_state=account.session_state,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _session_to_response(session: AuthSession) -> AuthSessionResponse:
    return AuthSessionResponse(
        id=session.id,
        session_token=session.session_token,
        user_id=session.user_id,
        expires=session.expires,
        role_snapshot=session.role_snapshot,
        permissions=_normalize_permissions(session.permissions),
        ip_address=session.ip_address,
        user_agent=session.user_agent,
        device_fingerprint=session.device_fingerprint,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def _verification_token_to_response(token: AuthVerificationToken) -> AuthVerificationTokenResponse:
    return AuthVerificationTokenResponse(
        identifier=token.identifier,
        token=token.token,
        expires=token.expires,
        created_at=token.created_at,
    )


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


@router.post("/users", response_model=AuthUserResponse, status_code=status.HTTP_201_CREATED)
async def create_auth_user(
    payload: AuthUserCreateRequest, db: AsyncSession = Depends(get_session)
) -> AuthUserResponse:
    normalized_email = payload.email
    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

    user = User(
        email=normalized_email,
        display_name=payload.display_name,
        role=payload.role,
        status=payload.status,
        email_verified_at=payload.email_verified_at,
        is_email_verified=bool(payload.email_verified_at),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_response(user)


EmailQuery = Annotated[str, Query(..., description="Email address to look up")]


@router.get("/users/by-email", response_model=AuthUserResponse)
async def get_auth_user_by_email(
    email: EmailQuery,
    db: AsyncSession = Depends(get_session),
) -> AuthUserResponse:
    normalized_email = _normalize_email_for_query(email)
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _user_to_response(user)


@router.get("/users/{user_id}", response_model=AuthUserResponse)
async def get_auth_user(user_id: UUID, db: AsyncSession = Depends(get_session)) -> AuthUserResponse:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _user_to_response(user)


@router.patch("/users/{user_id}", response_model=AuthUserResponse)
async def update_auth_user(
    user_id: UUID,
    payload: AuthUserUpdateRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthUserResponse:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updated = False
    if payload.display_name is not None:
        user.display_name = payload.display_name
        updated = True
    if payload.email_verified_at is not None:
        user.email_verified_at = payload.email_verified_at
        user.is_email_verified = True
        updated = True
    if payload.is_email_verified is not None:
        user.is_email_verified = payload.is_email_verified
        if not payload.is_email_verified:
            user.email_verified_at = None
        updated = True
    if payload.role is not None:
        user.role = payload.role
        updated = True
    if payload.status is not None:
        user.status = payload.status
        updated = True

    if updated:
        await db.commit()
        await db.refresh(user)

    return _user_to_response(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_auth_user(user_id: UUID, db: AsyncSession = Depends(get_session)) -> Response:
    user = await db.get(User, user_id)
    if not user:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/accounts",
    response_model=AuthAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def link_account(
    payload: AuthAccountCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthAccountResponse:
    user = await db.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    stmt = select(AuthAccount).where(
        AuthAccount.provider == payload.provider,
        AuthAccount.provider_account_id == payload.provider_account_id,
    )
    existing = await db.execute(stmt)
    account = existing.scalar_one_or_none()

    if account is None:
        account = AuthAccount(
            user_id=payload.user_id,
            type=payload.type,
            provider=payload.provider,
            provider_account_id=payload.provider_account_id,
            refresh_token=payload.refresh_token,
            access_token=payload.access_token,
            expires_at=payload.expires_at,
            token_type=payload.token_type,
            scope=payload.scope,
            id_token=payload.id_token,
            session_state=payload.session_state,
        )
        db.add(account)
    else:
        account.user_id = payload.user_id
        account.type = payload.type
        account.refresh_token = payload.refresh_token
        account.access_token = payload.access_token
        account.expires_at = payload.expires_at
        account.token_type = payload.token_type
        account.scope = payload.scope
        account.id_token = payload.id_token
        account.session_state = payload.session_state

    await db.commit()
    await db.refresh(account)
    return _account_to_response(account)


@router.delete("/accounts", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_account(
    payload: AuthAccountDeleteRequest,
    db: AsyncSession = Depends(get_session),
) -> Response:
    stmt = select(AuthAccount).where(
        AuthAccount.provider == payload.provider,
        AuthAccount.provider_account_id == payload.provider_account_id,
    )
    result = await db.execute(stmt)
    account = result.scalar_one_or_none()
    if account is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    await db.delete(account)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/accounts/by-provider", response_model=AuthAccountWithUserResponse)
async def get_user_by_account(
    provider: str,
    provider_account_id: str,
    db: AsyncSession = Depends(get_session),
) -> AuthAccountWithUserResponse:
    stmt = (
        select(AuthAccount, User)
        .join(User, AuthAccount.user_id == User.id)
        .where(
            AuthAccount.provider == provider,
            AuthAccount.provider_account_id == provider_account_id,
        )
    )
    result = await db.execute(stmt)
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    account, user = row
    return AuthAccountWithUserResponse(
        account=_account_to_response(account),
        user=_user_to_response(user),
    )


@router.post(
    "/sessions",
    response_model=AuthSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_auth_session(
    payload: AuthSessionCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthSessionResponse:
    user = await db.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    session = AuthSession(
        session_token=payload.session_token,
        user_id=payload.user_id,
        expires=payload.expires,
        role_snapshot=payload.role_snapshot,
        permissions=payload.permissions or [],
        ip_address=payload.ip_address,
        user_agent=payload.user_agent,
        device_fingerprint=payload.device_fingerprint,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_to_response(session)


@router.get("/sessions/{session_token}", response_model=AuthSessionWithUserResponse)
async def get_auth_session(
    session_token: str,
    db: AsyncSession = Depends(get_session),
) -> AuthSessionWithUserResponse:
    stmt = (
        select(AuthSession, User)
        .join(User, AuthSession.user_id == User.id)
        .where(AuthSession.session_token == session_token)
    )
    result = await db.execute(stmt)
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session, user = row
    return AuthSessionWithUserResponse(
        session=_session_to_response(session),
        user=_user_to_response(user),
    )


@router.patch("/sessions/{session_token}", response_model=AuthSessionResponse)
async def update_auth_session(
    session_token: str,
    payload: AuthSessionUpdateRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthSessionResponse:
    stmt = select(AuthSession).where(AuthSession.session_token == session_token)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if payload.expires is not None:
        session.expires = payload.expires
    if payload.role_snapshot is not None:
        session.role_snapshot = payload.role_snapshot
    if payload.permissions is not None:
        session.permissions = payload.permissions
    if payload.ip_address is not None:
        session.ip_address = payload.ip_address
    if payload.user_agent is not None:
        session.user_agent = payload.user_agent
    if payload.device_fingerprint is not None:
        session.device_fingerprint = payload.device_fingerprint

    await db.commit()
    await db.refresh(session)
    return _session_to_response(session)


@router.delete("/sessions/{session_token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_auth_session(
    session_token: str,
    db: AsyncSession = Depends(get_session),
) -> Response:
    await db.execute(delete(AuthSession).where(AuthSession.session_token == session_token))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/verification-tokens",
    response_model=AuthVerificationTokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_verification_token(
    payload: AuthVerificationTokenCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthVerificationTokenResponse:
    await db.execute(
        delete(AuthVerificationToken).where(AuthVerificationToken.token == payload.token)
    )
    token = AuthVerificationToken(
        identifier=payload.identifier,
        token=payload.token,
        expires=payload.expires,
    )
    db.add(token)
    await db.commit()
    await db.refresh(token)
    return _verification_token_to_response(token)


@router.post(
    "/verification-tokens/use",
    response_model=AuthVerificationTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def use_verification_token(
    payload: AuthVerificationTokenUseRequest,
    db: AsyncSession = Depends(get_session),
) -> AuthVerificationTokenResponse:
    stmt = select(AuthVerificationToken).where(
        AuthVerificationToken.identifier == payload.identifier,
        AuthVerificationToken.token == payload.token,
    )
    result = await db.execute(stmt)
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification token not found")

    await db.delete(token)
    await db.commit()
    return _verification_token_to_response(token)
