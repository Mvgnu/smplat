# Monorepo Setup Plan

## Structure Overview
```
/
├─ apps/
│  ├─ web/        # Next.js storefront + portals
│  ├─ api/        # FastAPI service
│  └─ cms/        # Sanity Studio (fallback only)
├─ apps-cms-payload/  # Payload admin (primary CMS)
├─ packages/
│  └─ shared/     # Shared utilities (types, constants, UI tokens)
├─ infra/         # Terraform/Pulumi manifests
├─ docs/
├─ .github/       # Workflows
└─ tooling/       # Scripts, linters, git hooks
```

## Tooling
- **Package Manager**: pnpm for frontend monorepo workspace management.
- **Build Orchestration**: Turborepo for task pipelines (`lint`, `test`, `build`, `deploy`).
- **Backend Dependency Management**: Poetry for FastAPI service; align with `pyproject.toml`.
- **Version Control**: Git with Conventional Commits; optional Changesets for release notes.

### Current Status (2025-10-15)
- pnpm workspace bootstrapped with lockfile committed (`pnpm-lock.yaml`).
- Auth.js REST adapter wired to FastAPI identity service (no Prisma client required).
- Poetry virtual environment created with dependencies installed (`poetry.lock`).
- Payload CMS app checked in under `apps-cms-payload` with admin import map and schema parity work underway.
- Payload seeding script available at `tooling/scripts/seed-payload.mjs` (run via `pnpm payload:seed:dev`).
- Sanity Studio scaffolded under `apps/cms` with baseline schemas and dependencies installed for fallback scenarios.
- Content seeding script for Sanity lives at `tooling/scripts/seed-sanity.mjs` (run via `pnpm seed:sanity`) when fallback is required.
- Local Postgres provided via `docker-compose`; start with `docker compose up postgres` before running FastAPI.

## Initial Commands
```
# Initialize pnpm workspace and Turborepo
pnpm init            # ✅ completed
pnpm dlx turbo init  # ✅ completed

# Scaffold Next.js app with Auth.js, Tailwind, TypeScript
pnpm create next-app apps/web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"  # ✅ completed (manual scaffolding equivalent)

# Scaffold FastAPI project skeleton
cd apps/api
poetry init  # ✅ completed
poetry add fastapi uvicorn sqlalchemy[asyncio] alembic pydantic[email] httpx redis celery  # ✅ completed via pyproject

# Create Sanity Studio (fallback)
pnpm dlx sanity@latest init --project smplat --dataset production --output-path apps/cms
```

> Note: Network access is required for scaffolding; run commands in dev environment with credentials.

## Configuration Files
- `pnpm-workspace.yaml`: include `apps/*` and `packages/*`.
- `turbo.json`: define pipelines (`build`, `dev`, `lint`, `test`, `typecheck`).
- `pyproject.toml`: managed via Poetry for backend dependencies.
- `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`.
- `.editorconfig`, `.prettierrc`, `.eslintrc`, `ruff.toml` (for Python).

## Continuous Integration
- GitHub Actions workflows:
  - `lint.yml`: run pnpm lint + poetry lint.
  - `test.yml`: run Jest/Playwright + PyTest.
  - `build.yml`: ensure production builds succeed.
- Cache pnpm store and Poetry virtualenv.

## Workspace Standards
- Enforce commit hooks via `lefthook` or `husky` + `lint-staged`.
- Centralized environment management with `tooling/env-sync` scripts.
- Document developer onboarding steps in `docs/onboarding.md`.
