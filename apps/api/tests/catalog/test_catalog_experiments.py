from __future__ import annotations

import datetime as dt
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from smplat_api.core.settings import settings
from smplat_api.jobs.bundle_guardrails import run_guardrail_evaluation
from smplat_api.models.catalog import CatalogBundle
from smplat_api.models.catalog_experiments import (
    CatalogBundleExperiment,
    CatalogBundleExperimentMetric,
    CatalogBundleExperimentStatus,
    CatalogBundleExperimentVariant,
)
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import Product, ProductStatusEnum
from smplat_api.workers.bundle_experiment_guardrails import BundleExperimentGuardrailWorker


async def _seed_products(session: AsyncSession) -> tuple[Product, Product]:
    primary = Product(
        id=uuid4(),
        slug="bundle-primary",
        title="Bundle Primary",
        description="",
        category="bundles",
        base_price=Decimal("199.00"),
        currency=CurrencyEnum.EUR,
        status=ProductStatusEnum.ACTIVE,
    )
    attachment = Product(
        id=uuid4(),
        slug="bundle-attachment",
        title="Bundle Attachment",
        description="",
        category="bundles",
        base_price=Decimal("99.00"),
        currency=CurrencyEnum.EUR,
        status=ProductStatusEnum.ACTIVE,
    )
    session.add_all([primary, attachment])
    await session.commit()
    return primary, attachment


async def _seed_bundles(
    session: AsyncSession,
    primary: Product,
    attachment: Product,
) -> tuple[str, str]:
    control_bundle = CatalogBundle(
        id=uuid4(),
        primary_product_slug=primary.slug,
        bundle_slug="bundle-control",
        title="Control Bundle",
        description="",
        savings_copy="Save 5%",
        cms_priority=50,
        components=[attachment.slug],
    )
    test_bundle = CatalogBundle(
        id=uuid4(),
        primary_product_slug=primary.slug,
        bundle_slug="bundle-test",
        title="Test Bundle",
        description="",
        savings_copy="Save 15%",
        cms_priority=45,
        components=[attachment.slug],
    )
    session.add_all([control_bundle, test_bundle])
    await session.commit()
    return control_bundle.bundle_slug, test_bundle.bundle_slug


@pytest_asyncio.fixture
async def experiment_client(app_with_db: tuple[object, async_sessionmaker[AsyncSession]]):
    app, factory = app_with_db

    async with factory() as session:
        primary, attachment = await _seed_products(session)
        await _seed_bundles(session, primary, attachment)

    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client, factory


@pytest.mark.asyncio
async def test_catalog_experiment_crud_and_guardrail_evaluation(
    experiment_client: tuple[AsyncClient, async_sessionmaker[AsyncSession]]
) -> None:
    client, factory = experiment_client

    create_payload = {
        "slug": "exp-alpha",
        "name": "Experiment Alpha",
        "description": "Test guardrail evaluation",
        "guardrail_config": {"min_acceptance_rate": 0.1},
        "sample_size_guardrail": 5,
        "variants": [
            {
                "key": "control",
                "name": "Control",
                "weight": 50,
                "is_control": True,
                "bundle_slug": "bundle-control",
                "override_payload": {"hero": "baseline"},
            },
            {
                "key": "test",
                "name": "Test",
                "weight": 50,
                "is_control": False,
                "bundle_slug": "bundle-test",
                "override_payload": {"hero": "variant"},
            },
        ],
    }

    response = await client.post("/api/v1/catalog/experiments", json=create_payload)
    assert response.status_code == 201
    payload = response.json()
    assert payload["slug"] == "exp-alpha"
    assert len(payload["variants"]) == 2

    list_response = await client.get("/api/v1/catalog/experiments")
    assert list_response.status_code == 200
    experiments = list_response.json()
    assert any(item["slug"] == "exp-alpha" for item in experiments)

    update_response = await client.put(
        "/api/v1/catalog/experiments/exp-alpha",
        json={"status": CatalogBundleExperimentStatus.RUNNING.value},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == CatalogBundleExperimentStatus.RUNNING.value

    async with factory() as session:
        experiment = (
            await session.execute(
                select(CatalogBundleExperiment)
                .options(
                    selectinload(CatalogBundleExperiment.variants).selectinload(
                        CatalogBundleExperimentVariant.metrics
                    )
                )
                .where(CatalogBundleExperiment.slug == "exp-alpha")
            )
        ).scalar_one()
        variants = {variant.key: variant for variant in experiment.variants}
        now = dt.datetime.now(dt.timezone.utc)
        session.add_all(
            [
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=variants["control"].id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.1800"),
                    acceptance_count=18,
                    sample_size=100,
                    lift_vs_control=Decimal("0"),
                    guardrail_breached=False,
                    computed_at=now,
                ),
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=variants["test"].id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.0200"),
                    acceptance_count=2,
                    sample_size=100,
                    lift_vs_control=None,
                    guardrail_breached=True,
                    computed_at=now,
                ),
            ]
        )
        await session.commit()

    evaluation_response = await client.post("/api/v1/catalog/experiments/exp-alpha/evaluate")
    assert evaluation_response.status_code == 200
    evaluation = evaluation_response.json()
    breaches = [entry for entry in evaluation["breaches"] if entry["breaches"]]
    assert len(breaches) == 1
    assert breaches[0]["variant_key"] == "test"
    assert "min_acceptance_rate" in breaches[0]["breaches"]

    publish_response = await client.post("/api/v1/catalog/experiments/exp-alpha/publish")
    assert publish_response.status_code == 200
    assert publish_response.json()["status"] == CatalogBundleExperimentStatus.RUNNING.value


class StubNotifier:
    def __init__(self) -> None:
        self.alerts: list = []

    async def notify(self, alerts) -> None:  # pragma: no cover - exercised in tests
        self.alerts.extend(list(alerts))


@pytest.mark.asyncio
async def test_guardrail_worker_pauses_and_notifies(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]]
) -> None:
    _, factory = app_with_db

    async with factory() as session:
        primary, attachment = await _seed_products(session)
        control_slug, test_slug = await _seed_bundles(session, primary, attachment)

        experiment = CatalogBundleExperiment(
            slug="exp-worker",
            name="Worker Experiment",
            description=None,
            status=CatalogBundleExperimentStatus.RUNNING,
            guardrail_config={"min_acceptance_rate": 0.1},
            sample_size_guardrail=10,
        )
        control_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="control",
            name="Control",
            weight=50,
            is_control=True,
            bundle_slug=control_slug,
            override_payload={"hero": "baseline"},
        )
        test_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="test",
            name="Test",
            weight=50,
            is_control=False,
            bundle_slug=test_slug,
            override_payload={"hero": "variant"},
        )
        session.add_all([experiment, control_variant, test_variant])
        await session.commit()

        now = dt.datetime.now(dt.timezone.utc)
        session.add_all(
            [
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=control_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.2000"),
                    acceptance_count=20,
                    sample_size=100,
                    guardrail_breached=False,
                    computed_at=now,
                ),
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=test_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.0200"),
                    acceptance_count=2,
                    sample_size=20,
                    guardrail_breached=True,
                    computed_at=now,
                ),
            ]
        )
        await session.commit()

    notifier = StubNotifier()
    worker = BundleExperimentGuardrailWorker(factory, notifier=notifier, interval_seconds=1)
    summary = await worker.run_once()

    assert summary["evaluated"] == 1
    assert summary["paused"] == 1
    assert notifier.alerts
    assert any(alert.experiment_slug == "exp-worker" for alert in notifier.alerts)

    async with factory() as session:
        status = (
            await session.execute(
                select(CatalogBundleExperiment.status).where(
                    CatalogBundleExperiment.slug == "exp-worker"
                )
            )
        ).scalar_one()
        assert status == CatalogBundleExperimentStatus.PAUSED


@pytest.mark.asyncio
async def test_guardrail_job_runs_once(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, factory = app_with_db
    monkeypatch.setattr(settings, "bundle_experiment_guardrail_worker_enabled", True, raising=False)

    async with factory() as session:
        primary, attachment = await _seed_products(session)
        control_slug, test_slug = await _seed_bundles(session, primary, attachment)

        experiment = CatalogBundleExperiment(
            slug="exp-job",
            name="Job Experiment",
            description=None,
            status=CatalogBundleExperimentStatus.RUNNING,
            guardrail_config={"min_acceptance_rate": 0.1},
            sample_size_guardrail=10,
        )
        control_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="control",
            name="Control",
            weight=50,
            is_control=True,
            bundle_slug=control_slug,
            override_payload={"hero": "baseline"},
        )
        test_variant = CatalogBundleExperimentVariant(
            experiment=experiment,
            key="test",
            name="Test",
            weight=50,
            is_control=False,
            bundle_slug=test_slug,
            override_payload={"hero": "variant"},
        )
        session.add_all([experiment, control_variant, test_variant])
        await session.commit()

        now = dt.datetime.now(dt.timezone.utc)
        session.add_all(
            [
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=control_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.2000"),
                    acceptance_count=20,
                    sample_size=100,
                    guardrail_breached=False,
                    computed_at=now,
                ),
                CatalogBundleExperimentMetric(
                    experiment_id=experiment.id,
                    variant_id=test_variant.id,
                    window_start=now.date(),
                    lookback_days=30,
                    acceptance_rate=Decimal("0.0200"),
                    acceptance_count=2,
                    sample_size=20,
                    guardrail_breached=True,
                    computed_at=now,
                ),
            ]
        )
        await session.commit()

    summary = await run_guardrail_evaluation(session_factory=factory)
    assert summary["paused"] == 1

    async with factory() as session:
        status = (
            await session.execute(
                select(CatalogBundleExperiment.status).where(
                    CatalogBundleExperiment.slug == "exp-job"
                )
            )
        ).scalar_one()
        assert status == CatalogBundleExperimentStatus.PAUSED


@pytest.mark.asyncio
async def test_guardrail_worker_handles_multiple_breaches(
    app_with_db: tuple[object, async_sessionmaker[AsyncSession]]
) -> None:
    _, factory = app_with_db

    async with factory() as session:
        primary, attachment = await _seed_products(session)
        control_slug, test_slug = await _seed_bundles(session, primary, attachment)

        experiments: list[CatalogBundleExperiment] = []
        variants: list[tuple[CatalogBundleExperimentVariant, CatalogBundleExperimentVariant]] = []
        for suffix in ("one", "two"):
            experiment = CatalogBundleExperiment(
                slug=f"exp-multi-{suffix}",
                name=f"Multi Experiment {suffix}",
                description=None,
                status=CatalogBundleExperimentStatus.RUNNING,
                guardrail_config={"min_acceptance_rate": 0.1},
                sample_size_guardrail=10,
            )
            control_variant = CatalogBundleExperimentVariant(
                experiment=experiment,
                key="control",
                name="Control",
                weight=50,
                is_control=True,
                bundle_slug=control_slug,
                override_payload={"hero": "baseline"},
            )
            test_variant = CatalogBundleExperimentVariant(
                experiment=experiment,
                key="test",
                name="Test",
                weight=50,
                is_control=False,
                bundle_slug=test_slug,
                override_payload={"hero": "variant"},
            )
            experiments.append(experiment)
            variants.append((control_variant, test_variant))

        session.add_all(experiments)
        for control_variant, test_variant in variants:
            session.add_all([control_variant, test_variant])
        await session.commit()

        now = dt.datetime.now(dt.timezone.utc)
        metrics: list[CatalogBundleExperimentMetric] = []
        for experiment, (control_variant, test_variant) in zip(experiments, variants, strict=True):
            metrics.extend(
                [
                    CatalogBundleExperimentMetric(
                        experiment_id=experiment.id,
                        variant_id=control_variant.id,
                        window_start=now.date(),
                        lookback_days=30,
                        acceptance_rate=Decimal("0.2500"),
                        acceptance_count=25,
                        sample_size=100,
                        guardrail_breached=False,
                        computed_at=now,
                    ),
                    CatalogBundleExperimentMetric(
                        experiment_id=experiment.id,
                        variant_id=test_variant.id,
                        window_start=now.date(),
                        lookback_days=30,
                        acceptance_rate=Decimal("0.0200"),
                        acceptance_count=2,
                        sample_size=20,
                        guardrail_breached=True,
                        computed_at=now,
                    ),
                ]
            )
        session.add_all(metrics)
        await session.commit()

    notifier = StubNotifier()
    worker = BundleExperimentGuardrailWorker(factory, notifier=notifier, interval_seconds=1)
    summary = await worker.run_once()

    assert summary == {"evaluated": 2, "paused": 2, "alerts": 2}
    assert {alert.experiment_slug for alert in notifier.alerts} == {"exp-multi-one", "exp-multi-two"}

    async with factory() as session:
        statuses = (
            await session.execute(
                select(CatalogBundleExperiment.slug, CatalogBundleExperiment.status)
                .where(CatalogBundleExperiment.slug.in_(["exp-multi-one", "exp-multi-two"]))
                .order_by(CatalogBundleExperiment.slug)
            )
        ).all()
        assert statuses == [
            ("exp-multi-one", CatalogBundleExperimentStatus.PAUSED),
            ("exp-multi-two", CatalogBundleExperimentStatus.PAUSED),
        ]
