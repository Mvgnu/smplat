"""merge preset alert runs and configuration presets branch"""

from __future__ import annotations

from alembic import op


revision = "20251217_45_merge_heads"
down_revision = ("120fdd61c004_add_configuration_presets_column", "20251217_44_preset_event_alert_runs")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
