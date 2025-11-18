"""Onboarding journey persistence models."""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from smplat_api.db.base import Base


class OnboardingJourneyStatus(str, Enum):
    """Lifecycle state of an onboarding journey."""

    NOT_STARTED = "not_started"
    ACTIVE = "active"
    COMPLETED = "completed"
    STALLED = "stalled"


class OnboardingTaskStatus(str, Enum):
    """Lifecycle status for individual onboarding tasks."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"


class OnboardingActorType(str, Enum):
    """Participants who can log journey interactions."""

    CLIENT = "client"
    OPERATOR = "operator"
    SYSTEM = "system"


class OnboardingInteractionChannel(str, Enum):
    """Channel used for logging journey interactions."""

    DASHBOARD = "dashboard"
    EMAIL = "email"
    SLACK = "slack"
    OTHER = "other"


class OnboardingEventType(str, Enum):
    """Event types persisted for analytics deltas."""

    JOURNEY_STARTED = "journey_started"
    TASK_STATUS_CHANGED = "task_status_changed"
    ARTIFACT_RECEIVED = "artifact_received"
    REFERRAL_COPIED = "referral_copied"
    PRICING_EXPERIMENT_SEGMENT = "pricing_experiment_segment"


class OnboardingJourney(Base):
    """Durable representation of a client's onboarding journey."""

    # meta: model: onboarding-journey

    __tablename__ = "onboarding_journeys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    status = Column(
        SqlEnum(OnboardingJourneyStatus, name="onboarding_journey_status"),
        nullable=False,
        server_default=OnboardingJourneyStatus.NOT_STARTED.value,
    )
    current_step = Column(String, nullable=True)
    referral_code = Column(String, nullable=True)
    context = Column(JSON, nullable=True)
    progress_percentage = Column(Numeric(5, 2), nullable=False, server_default="0")
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    tasks = relationship(
        "OnboardingTask",
        back_populates="journey",
        cascade="all, delete-orphan",
        order_by="OnboardingTask.sort_order",
    )
    artifacts = relationship(
        "OnboardingArtifact", back_populates="journey", cascade="all, delete-orphan"
    )
    interactions = relationship(
        "OnboardingInteraction", back_populates="journey", cascade="all, delete-orphan"
    )
    events = relationship(
        "OnboardingEvent", back_populates="journey", cascade="all, delete-orphan"
    )


class OnboardingTask(Base):
    """Discrete onboarding tasks that roll up to a journey."""

    # meta: model: onboarding-task

    __tablename__ = "onboarding_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    journey_id = Column(
        UUID(as_uuid=True), ForeignKey("onboarding_journeys.id", ondelete="CASCADE"), nullable=False
    )
    slug = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        SqlEnum(OnboardingTaskStatus, name="onboarding_task_status"),
        nullable=False,
        server_default=OnboardingTaskStatus.PENDING.value,
    )
    sort_order = Column(Integer, nullable=False, server_default="0")
    due_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    assignee = Column(String, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    journey = relationship("OnboardingJourney", back_populates="tasks")
    artifacts = relationship("OnboardingArtifact", back_populates="task", cascade="all, delete-orphan")
    interactions = relationship(
        "OnboardingInteraction", back_populates="task", cascade="all, delete-orphan"
    )
    events = relationship("OnboardingEvent", back_populates="task", cascade="all, delete-orphan")


class OnboardingArtifact(Base):
    """Artifacts (files, links) shared during onboarding."""

    # meta: model: onboarding-artifact

    __tablename__ = "onboarding_artifacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    journey_id = Column(
        UUID(as_uuid=True), ForeignKey("onboarding_journeys.id", ondelete="CASCADE"), nullable=False
    )
    task_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_tasks.id", ondelete="SET NULL"), nullable=True)
    label = Column(String, nullable=False)
    url = Column(Text, nullable=True)
    required = Column(Boolean, nullable=False, server_default="false")
    received_at = Column(DateTime(timezone=True), nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    journey = relationship("OnboardingJourney", back_populates="artifacts")
    task = relationship("OnboardingTask", back_populates="artifacts")


class OnboardingInteraction(Base):
    """Interaction log entries for operators and clients."""

    # meta: model: onboarding-interaction

    __tablename__ = "onboarding_interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    journey_id = Column(
        UUID(as_uuid=True), ForeignKey("onboarding_journeys.id", ondelete="CASCADE"), nullable=False
    )
    task_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_tasks.id", ondelete="SET NULL"), nullable=True)
    actor_type = Column(
        SqlEnum(OnboardingActorType, name="onboarding_actor_type"),
        nullable=False,
        server_default=OnboardingActorType.SYSTEM.value,
    )
    channel = Column(
        SqlEnum(OnboardingInteractionChannel, name="onboarding_interaction_channel"),
        nullable=False,
        server_default=OnboardingInteractionChannel.DASHBOARD.value,
    )
    summary = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    journey = relationship("OnboardingJourney", back_populates="interactions")
    task = relationship("OnboardingTask", back_populates="interactions")


class OnboardingEvent(Base):
    """Normalized onboarding analytics deltas."""

    # meta: model: onboarding-event

    __tablename__ = "onboarding_journey_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    journey_id = Column(
        UUID(as_uuid=True), ForeignKey("onboarding_journeys.id", ondelete="CASCADE"), nullable=False
    )
    task_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_tasks.id", ondelete="SET NULL"), nullable=True)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(
        SqlEnum(OnboardingEventType, name="onboarding_event_type"),
        nullable=False,
    )
    status_before = Column(String, nullable=True)
    status_after = Column(String, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    journey = relationship("OnboardingJourney", back_populates="events")
    task = relationship("OnboardingTask", back_populates="events")
