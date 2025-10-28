"""Catalog bundle recommendation tables."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251105_21"
down_revision: Union[str, None] = "20251102_20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "catalog_bundles",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("primary_product_slug", sa.String(), nullable=False),
        sa.Column("bundle_slug", sa.String(), nullable=False, unique=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("savings_copy", sa.String(), nullable=True),
        sa.Column("cms_priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("components", sa.JSON(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "ix_catalog_bundles_primary_product_slug",
        "catalog_bundles",
        ["primary_product_slug"],
    )

    op.create_table(
        "catalog_bundle_acceptance_metrics",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("bundle_slug", sa.String(), nullable=False),
        sa.Column("lookback_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("acceptance_rate", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("acceptance_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["bundle_slug"], ["catalog_bundles.bundle_slug"], ondelete="CASCADE"),
        sa.UniqueConstraint("bundle_slug", "lookback_days", name="uq_bundle_acceptance_window"),
    )

    op.create_table(
        "catalog_recommendation_cache",
        sa.Column("primary_slug", sa.String(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("catalog_recommendation_cache")
    op.drop_table("catalog_bundle_acceptance_metrics")
    op.drop_index("ix_catalog_bundles_primary_product_slug", table_name="catalog_bundles")
    op.drop_table("catalog_bundles")
