from enum import Enum
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum as SqlEnum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class CurrencyEnum(str, Enum):
    EUR = "EUR"
    USD = "USD"


class CustomerProfile(Base):
    __tablename__ = "customer_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    company_name = Column(String, nullable=True)
    vat_id = Column(String, nullable=True)
    street_address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    country = Column(String(2), nullable=True)
    instagram_handle = Column(String, nullable=True)
    preferred_currency = Column(SqlEnum(CurrencyEnum, name="preferred_currency_enum"), nullable=False, server_default=CurrencyEnum.EUR.value)
    marketing_consent = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    instagram_accounts = relationship("InstagramAccount", back_populates="customer_profile", cascade="all, delete-orphan")
    social_accounts = relationship("CustomerSocialAccount", back_populates="customer_profile", cascade="all, delete-orphan")
