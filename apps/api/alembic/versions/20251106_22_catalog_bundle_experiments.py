"""Catalog bundle experiment tables."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251106_22"
down_revision: Union[str, None] = "20251105_21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "catalog_bundle_experiments",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("draft", "running", "paused", "completed", name="catalogbundleexperimentstatus"), nullable=False, server_default="draft"),
        sa.Column("guardrail_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sample_size_guardrail", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "catalog_bundle_experiment_variants",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("experiment_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("catalog_bundle_experiments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_control", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("bundle_slug", sa.String(), sa.ForeignKey("catalog_bundles.bundle_slug", ondelete="SET NULL"), nullable=True),
        sa.Column("override_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("experiment_id", "key", name="uq_bundle_experiment_variant_key"),
    )

    op.create_table(
        "catalog_bundle_experiment_metrics",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("experiment_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("catalog_bundle_experiments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("catalog_bundle_experiment_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("window_start", sa.Date(), nullable=False),
        sa.Column("lookback_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("acceptance_rate", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("acceptance_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lift_vs_control", sa.Numeric(6, 4), nullable=True),
        sa.Column("guardrail_breached", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.UniqueConstraint("variant_id", "window_start", "lookback_days", name="uq_bundle_experiment_metric_window"),
    )


def downgrade() -> None:
    op.drop_table("catalog_bundle_experiment_metrics")
    op.drop_table("catalog_bundle_experiment_variants")
    op.drop_table("catalog_bundle_experiments")
    op.execute("DROP TYPE IF EXISTS catalogbundleexperimentstatus")
