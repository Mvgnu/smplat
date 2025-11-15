from enum import Enum
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class UserRoleEnum(str, Enum):
    CLIENT = "client"
    ADMIN = "admin"
    FINANCE = "finance"


class UserStatusEnum(str, Enum):
    ACTIVE = "active"
    INVITED = "invited"
    SUSPENDED = "suspended"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    phone_number = Column(String(32), nullable=True)
    push_token = Column(String(128), nullable=True)
    role = Column(String(length=16), nullable=False, default=UserRoleEnum.CLIENT.value, server_default=UserRoleEnum.CLIENT.value)
    status = Column(String(length=16), nullable=False, default=UserStatusEnum.ACTIVE.value, server_default=UserStatusEnum.ACTIVE.value)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    is_email_verified = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
