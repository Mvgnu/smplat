# SMPLAT FastAPI Service

## Local Development
```bash
poetry install
poetry run uvicorn smplat_api.app:create_app --factory --reload
```

## Testing
```bash
poetry install  # ensures pytest-asyncio and other plugins are present
poetry run pytest
```

See `/docs` for full architecture decisions.
