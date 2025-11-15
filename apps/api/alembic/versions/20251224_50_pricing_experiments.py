"""Add pricing experiment tables."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251224_50_pricing_experiments"
down_revision = "20251223_49_journey_runtime_telemetry"
branch_labels = None
depends_on = None


pricing_status_enum = postgresql.ENUM(
    "draft",
    "running",
    "paused",
    "completed",
    name="pricing_experiment_status",
    create_type=False,
)
pricing_adjustment_enum = postgresql.ENUM(
    "delta",
    "multiplier",
    name="pricing_adjustment_kind",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            BEGIN
                CREATE TYPE pricing_experiment_status AS ENUM (
                    'draft',
                    'running',
                    'paused',
                    'completed'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        END$$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            BEGIN
                CREATE TYPE pricing_adjustment_kind AS ENUM (
                    'delta',
                    'multiplier'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END;
        END$$;
        """
    )

    op.create_table(
        "pricing_experiments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("slug", sa.String(length=150), nullable=False, unique=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("target_product_slug", sa.String(length=150), nullable=False),
        sa.Column("target_segment", sa.String(length=120), nullable=True),
        sa.Column("feature_flag_key", sa.String(length=150), nullable=True),
        sa.Column("assignment_strategy", sa.String(length=120), nullable=False),
        sa.Column(
            "status",
            pricing_status_enum,
            nullable=False,
            server_default="draft",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "pricing_experiment_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "experiment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pricing_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_control", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "adjustment_kind",
            pricing_adjustment_enum,
            nullable=False,
            server_default="delta",
        ),
        sa.Column("price_delta_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("price_multiplier", sa.Numeric(8, 4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("experiment_id", "key", name="uq_pricing_variant_experiment_key"),
    )

    op.create_table(
        "pricing_experiment_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "experiment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pricing_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "variant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pricing_experiment_variants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("window_start", sa.Date(), nullable=False),
        sa.Column("exposures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conversions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revenue_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("variant_id", "window_start", name="uq_pricing_metric_variant_window"),
    )


def downgrade() -> None:
    op.drop_table("pricing_experiment_metrics")
    op.drop_table("pricing_experiment_variants")
    op.drop_table("pricing_experiments")
    pricing_adjustment_enum.drop(op.get_bind(), checkfirst=True)
    pricing_status_enum.drop(op.get_bind(), checkfirst=True)
