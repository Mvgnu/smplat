from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    environment: Literal["development", "staging", "production"] = "development"
    database_url: str = "sqlite+aiosqlite:///./smplat.db"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me"
    sentry_dsn: str | None = None
    
    # Stripe configuration
    stripe_public_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    
    # Application URLs
    frontend_url: str = "http://localhost:3000"
    api_base_url: str = "http://localhost:8000"

    # Fulfillment worker
    fulfillment_worker_enabled: bool = False
    fulfillment_poll_interval_seconds: int = 30
    fulfillment_batch_size: int = 25

    # Internal API security
    checkout_api_key: str = ""

    # Billing rollout
    billing_rollout_stage: Literal["disabled", "pilot", "ga"] = "pilot"
    billing_rollout_workspaces: list[str] = Field(default_factory=list)

    @field_validator("billing_rollout_workspaces", mode="before")
    @classmethod
    def _parse_rollout_list(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    # Email / notification settings
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    smtp_sender_email: str | None = None
    weekly_digest_enabled: bool = False
    weekly_digest_interval_seconds: int = 7 * 24 * 60 * 60
    weekly_digest_dry_run: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]


settings = get_settings()
