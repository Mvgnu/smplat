"""add configuration presets column"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "120fdd61c004_add_configuration_presets_column"
down_revision = "20251215_42_product_media_asset_enrichment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("configuration_presets", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("products", "configuration_presets")
