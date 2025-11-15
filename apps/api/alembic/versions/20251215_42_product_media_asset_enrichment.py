"""enrich product media asset metadata"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251215_42_product_media_asset_enrichment"
down_revision = "20251212_41_provider_automation_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product_media_assets",
        sa.Column("client_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "product_media_assets",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "product_media_assets",
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "product_media_assets",
        sa.Column("alt_text", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "product_media_assets",
        sa.Column(
            "usage_tags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    op.add_column(
        "product_media_assets",
        sa.Column("checksum", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("product_media_assets", "checksum")
    op.drop_column("product_media_assets", "usage_tags")
    op.drop_column("product_media_assets", "alt_text")
    op.drop_column("product_media_assets", "is_primary")
    op.drop_column("product_media_assets", "display_order")
    op.drop_column("product_media_assets", "client_id")
