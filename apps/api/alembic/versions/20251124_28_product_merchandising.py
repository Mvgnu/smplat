from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20251124_28"
down_revision: Union[str, None] = "20251122_27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum type idempotently
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_audit_action') THEN
                CREATE TYPE product_audit_action AS ENUM (
                    'created',
                    'updated',
                    'deleted',
                    'restored'
                );
            END IF;
        END $$;
    """)

    op.add_column(
        "products",
        sa.Column(
            "channel_eligibility",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    op.create_table(
        "product_media_assets",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("label", sa.String(length=150), nullable=True),
        sa.Column("asset_url", sa.String(length=1024), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_product_media_assets_product",
        "product_media_assets",
        ["product_id", "created_at"],
    )

    op.create_table(
        "product_audit_logs",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "action",
            postgresql.ENUM(
                "created",
                "updated",
                "deleted",
                "restored",
                name="product_audit_action",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("actor_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("before_snapshot", sa.JSON(), nullable=True),
        sa.Column("after_snapshot", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_product_audit_logs_product",
        "product_audit_logs",
        ["product_id", "created_at"],
    )



def downgrade() -> None:
    op.drop_index(
        "ix_product_audit_logs_product",
        table_name="product_audit_logs",
    )
    op.drop_table("product_audit_logs")

    op.drop_index(
        "ix_product_media_assets_product",
        table_name="product_media_assets",
    )
    op.drop_table("product_media_assets")

    op.drop_column("products", "channel_eligibility")

    op.execute("DROP TYPE IF EXISTS product_audit_action")
