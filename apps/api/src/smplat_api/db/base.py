from sqlalchemy.orm import DeclarativeBase, declared_attr


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models with automatic table naming."""

    @declared_attr.directive
    def __tablename__(cls) -> str:  # noqa: N805
        return cls.__name__.lower()


# Import models to ensure metadata registration for Alembic
try:  # pragma: no cover - import side effects only
    import smplat_api.models  # noqa: F401,WPS433
except Exception:  # pragma: no cover - avoid breaking during migrations if imports fail
    pass
