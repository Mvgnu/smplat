"""Add journey component registry and product linkage tables"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20251220_47_journey_components"
down_revision = "20251218_46_preset_metric_trend_stats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "journey_components",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column("key", sa.String(length=150), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "triggers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "script_slug",
            sa.String(length=255),
            nullable=False,
        ),
        sa.Column("script_version", sa.String(length=64), nullable=True),
        sa.Column("script_runtime", sa.String(length=64), nullable=True),
        sa.Column("script_entrypoint", sa.String(length=255), nullable=True),
        sa.Column(
            "input_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("output_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("provider_dependencies", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.Column("retry_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("telemetry_labels", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "product_journey_components",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("component_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("channel_eligibility", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "bindings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["component_id"], ["journey_components.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("product_id", "component_id", name="uq_product_journey_component_product_component"),
    )
    op.create_index(
        "ix_product_journey_components_product",
        "product_journey_components",
        ["product_id"],
    )
    op.create_index(
        "ix_product_journey_components_component",
        "product_journey_components",
        ["component_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_product_journey_components_component", table_name="product_journey_components")
    op.drop_index("ix_product_journey_components_product", table_name="product_journey_components")
    op.drop_table("product_journey_components")
    op.drop_table("journey_components")
