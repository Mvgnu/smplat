"""add custom field metadata json"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251205_35_product_custom_field_metadata"
down_revision = "20251203_34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product_custom_fields",
        sa.Column("metadata_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("product_custom_fields", "metadata_json")
