from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    environment: Literal["development", "staging", "production"] = "development"
    database_url: str = "sqlite+aiosqlite:///./smplat.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    celery_default_queue: str = "smplat-default"
    journey_runtime_worker_enabled: bool = False
    journey_runtime_task_queue: str = "journey-runtime"
    journey_runtime_poll_interval_seconds: int = 5
    journey_runtime_batch_size: int = 10
    journey_runtime_runner_url: str | None = None
    journey_runtime_runner_api_key: str | None = None
    journey_runtime_runner_timeout_seconds: float = 15.0
    secret_key: str = "change-me"
    sentry_dsn: str | None = None
    
    # Stripe configuration
    stripe_public_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_secret_cache_ttl_seconds: int = 300

    # Application URLs
    frontend_url: str = "http://localhost:3000"
    api_base_url: str = "http://localhost:8000"

    # Fulfillment worker
    fulfillment_worker_enabled: bool = False
    fulfillment_poll_interval_seconds: int = 30
    fulfillment_batch_size: int = 25

    # Internal API security
    checkout_api_key: str = ""
    # Auth security
    # security-lockout: redis-threshold-config
    auth_lockout_threshold: int = 5
    auth_lockout_window_seconds: int = 300
    auth_lockout_duration_seconds: int = 900

    # Loyalty referrals (member surface)
    referral_member_reward_points: float = 500.0
    referral_member_max_active_invites: int = 5
    referral_member_invite_cooldown_seconds: int = 300

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

    # Hosted recovery automation
    hosted_recovery_worker_enabled: bool = False
    hosted_recovery_interval_seconds: int = 300
    hosted_recovery_limit: int = 100
    hosted_recovery_max_attempts: int = 5
    hosted_recovery_trigger_label: str = "scheduler"
    hosted_recovery_email_enabled: bool = False
    hosted_recovery_email_recipients: list[str] = Field(default_factory=list)

    @field_validator("hosted_recovery_email_recipients", mode="before")
    @classmethod
    def _parse_recovery_recipients(cls, value: object) -> list[str]:
        return cls._parse_rollout_list(value)

    hosted_recovery_slack_enabled: bool = False
    hosted_recovery_slack_webhook_url: str | None = None
    hosted_recovery_slack_channel: str | None = None
    sendgrid_api_key: str | None = None
    sendgrid_sender_email: str | None = None

    # Catalog experimentation guardrails
    bundle_experiment_guardrail_worker_enabled: bool = False
    bundle_experiment_guardrail_interval_seconds: int = 15 * 60
    bundle_experiment_guardrail_email_recipients: list[str] = Field(default_factory=list)
    bundle_experiment_guardrail_slack_webhook_url: str | None = None
    bundle_experiment_guardrail_slack_channel: str | None = None

    @field_validator("bundle_experiment_guardrail_email_recipients", mode="before")
    @classmethod
    def _parse_guardrail_recipients(cls, value: object) -> list[str]:
        return cls._parse_rollout_list(value)

    # Catalog automation scheduler
    catalog_job_scheduler_enabled: bool = False
    catalog_job_schedule_path: str = "config/schedules.toml"
    bundle_acceptance_aggregation_enabled: bool = False

    # Provider automation replay worker
    provider_replay_worker_enabled: bool = False
    provider_replay_worker_interval_seconds: int = 300
    provider_replay_worker_limit: int = 25
    provider_automation_replay_task_queue: str = "provider-replay"
    provider_automation_alert_worker_enabled: bool = False
    provider_automation_alert_interval_seconds: int = 15 * 60
    provider_automation_alert_snapshot_limit: int = 25
    provider_automation_alert_guardrail_fail_threshold: int = 3
    provider_automation_alert_guardrail_warn_threshold: int = 5
    provider_automation_alert_replay_failure_threshold: int = 3
    provider_automation_alert_task_queue: str = "provider-alerts"
    provider_automation_alert_email_recipients: list[str] = Field(default_factory=list)
    provider_automation_alert_slack_webhook_url: str | None = None
    provider_automation_alert_slack_channel: str | None = None
    provider_load_alert_enabled: bool = True
    provider_load_alert_short_window_days: int = 7
    provider_load_alert_long_window_days: int = 90
    provider_load_alert_share_threshold: float = 0.6
    provider_load_alert_delta_threshold: float = 0.2
    provider_load_alert_min_engagements: int = 10
    provider_load_alert_max_results: int = 25
    provider_automation_status_history_limit: int = 20

    @field_validator("provider_automation_alert_email_recipients", mode="before")
    @classmethod
    def _parse_provider_alert_recipients(cls, value: object) -> list[str]:
        return cls._parse_rollout_list(value)

    # Preset analytics alerting
    preset_event_alert_notifications_enabled: bool = False
    preset_event_alert_window_days: int = 30
    preset_event_alert_email_recipients: list[str] = Field(default_factory=list)
    preset_event_alert_slack_webhook_url: str | None = None
    preset_event_alert_slack_channel: str | None = None

    @field_validator("preset_event_alert_email_recipients", mode="before")
    @classmethod
    def _parse_preset_alert_recipients(cls, value: object) -> list[str]:
        return cls._parse_rollout_list(value)

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

    # Vault configuration
    vault_addr: str | None = None
    vault_token: str | None = None
    vault_namespace: str | None = None
    vault_timeout_seconds: float = 5.0
    vault_stripe_mount_path: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]


settings = get_settings()
