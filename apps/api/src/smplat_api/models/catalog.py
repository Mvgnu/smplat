"""Catalog-centric models supporting bundle recommendations."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID

from smplat_api.db.base import Base


class CatalogBundle(Base):
    """Deterministic bundle configuration sourced from the merchandising catalog."""

    # meta: provenance: catalog-core
    __tablename__ = "catalog_bundles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    primary_product_slug = Column(String, nullable=False, index=True)
    bundle_slug = Column(String, nullable=False, unique=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    savings_copy = Column(String, nullable=True)
    cms_priority = Column(Integer, nullable=False, server_default="100")
    components = Column(JSON, nullable=False, default=list)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def component_slugs(self) -> list[str]:
        """Return a normalized list of component product slugs."""

        raw = self.components or []
        if isinstance(raw, list):
            results: list[str] = []
            for entry in raw:
                if isinstance(entry, str) and entry.strip():
                    results.append(entry.strip())
                elif isinstance(entry, dict):
                    slug = entry.get("slug")
                    if isinstance(slug, str) and slug.strip():
                        results.append(slug.strip())
            return results
        return []


class CatalogBundleAcceptanceMetric(Base):
    """Aggregated acceptance telemetry for bundle experiments."""

    # meta: provenance: bundle-analytics
    __tablename__ = "catalog_bundle_acceptance_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    bundle_slug = Column(
        String,
        ForeignKey("catalog_bundles.bundle_slug", ondelete="CASCADE"),
        nullable=False,
    )
    lookback_days = Column(Integer, nullable=False, server_default="30")
    acceptance_rate = Column(Numeric(6, 4), nullable=False, server_default="0")
    acceptance_count = Column(Integer, nullable=False, server_default="0")
    sample_size = Column(Integer, nullable=False, server_default="0")
    last_accepted_at = Column(DateTime(timezone=True), nullable=True)
    computed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("bundle_slug", "lookback_days", name="uq_bundle_acceptance_window"),
    )

    def acceptance_rate_float(self) -> float:
        """Return the acceptance rate as a floating point value."""

        try:
            if self.acceptance_rate is None:
                return 0.0
            return float(self.acceptance_rate)
        except (TypeError, ValueError):  # pragma: no cover - defensive conversion
            return 0.0


class CatalogRecommendationCache(Base):
    """Durable cache payload for catalog recommendation snapshots."""

    # meta: cache-layer: persistent
    __tablename__ = "catalog_recommendation_cache"

    primary_slug = Column(String, primary_key=True)
    payload = Column(JSON, nullable=False, default=list)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    computed_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    def as_dict(self) -> dict[str, Any]:
        """Serialize the cache payload for service consumption."""

        return {
            "primary_slug": self.primary_slug,
            "payload": self.payload if isinstance(self.payload, list) else [],
            "metadata": self.metadata_json if isinstance(self.metadata_json, dict) else {},
            "computed_at": self.computed_at,
            "expires_at": self.expires_at,
        }
