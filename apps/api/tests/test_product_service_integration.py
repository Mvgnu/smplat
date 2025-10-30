from __future__ import annotations

from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import ProductStatusEnum, ProductSubscriptionBillingCycleEnum
from smplat_api.schemas.product import (
    ProductAddOnWrite,
    ProductConfigurationMutation,
    ProductCreate,
    ProductCustomFieldType,
    ProductCustomFieldWrite,
    ProductOptionGroupType,
    ProductOptionGroupWrite,
    ProductOptionWrite,
    ProductSubscriptionBillingCycle,
    ProductSubscriptionPlanWrite,
    ProductUpdate,
)
from smplat_api.services.products import ProductService


@pytest.mark.asyncio
async def test_product_service_crud(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        created = await service.create_product(
            ProductCreate(
                slug="ugc-lab",
                title="UGC Lab",
                description="Creator content pipeline",
                category="ugc",
                basePrice=120.00,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
                channelEligibility=["storefront"],
            )
        )

        fetched = await service.get_product_by_slug("ugc-lab")
        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.channel_eligibility == ["storefront"]

        updated = await service.update_product(
            fetched,
            ProductUpdate(title="UGC Lab+", basePrice=140.00, channelEligibility=["loyalty", "storefront"]),
        )
        assert updated.title == "UGC Lab+"
        assert float(updated.base_price) == 140.0
        assert set(updated.channel_eligibility) == {"loyalty", "storefront"}

        all_products = await service.list_products()
        assert len(list(all_products)) == 1

        audit_log = await service.list_audit_logs(created.id)
        assert len(audit_log) >= 2

        await service.delete_product(created.id)
        remaining = await service.list_products()
        assert list(remaining) == []


@pytest.mark.asyncio
async def test_product_service_prevents_duplicate_slug(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        await service.create_product(
            ProductCreate(
                slug="duplicate-slug",
                title="Original",
                category="core",
                basePrice=50.00,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
        )

        with pytest.raises(ValueError):
            await service.create_product(
                ProductCreate(
                    slug="duplicate-slug",
                    title="Clone",
                    category="core",
                    basePrice=75.00,
                    currency=CurrencyEnum.EUR,
                    status=ProductStatusEnum.ACTIVE,
                )
            )


@pytest.mark.asyncio
async def test_product_audit_restore(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        created = await service.create_product(
            ProductCreate(
                slug="audit-target",
                title="Audit Target",
                category="core",
                basePrice=99.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
        )

        product = await service.get_product_by_id(created.id)
        assert product is not None

        updated = await service.update_product(
            product,
            ProductUpdate(title="Audit Target Updated", channelEligibility=["dashboard"]),
        )
        assert updated.title == "Audit Target Updated"

        audit_entries = await service.list_audit_logs(created.id)
        assert len(audit_entries) >= 2

        target_entry = next((entry for entry in audit_entries if entry.before_snapshot), None)
        assert target_entry is not None

        restored = await service.restore_from_audit(target_entry.id)
        assert restored is not None
        assert restored.title == "Audit Target"


@pytest.mark.asyncio
async def test_product_configuration_upsert_and_patch(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        configuration = ProductConfigurationMutation(
            option_groups=[
                ProductOptionGroupWrite(
                    name="Color",
                    description="Select a palette",
                    group_type=ProductOptionGroupType.SINGLE,
                    is_required=True,
                    display_order=0,
                    options=[
                        ProductOptionWrite(name="Crimson", priceDelta=15.0, displayOrder=0),
                        ProductOptionWrite(name="Azure", priceDelta=0.0, displayOrder=1),
                    ],
                )
            ],
            add_ons=[
                ProductAddOnWrite(
                    label="Expedited Setup",
                    description="Launch within 48 hours",
                    priceDelta=75.0,
                    isRecommended=True,
                    displayOrder=0,
                )
            ],
            custom_fields=[
                ProductCustomFieldWrite(
                    label="Brand Hex",
                    field_type=ProductCustomFieldType.TEXT,
                    is_required=True,
                    display_order=0,
                )
            ],
            subscription_plans=[
                ProductSubscriptionPlanWrite(
                    label="Monthly",
                    billing_cycle=ProductSubscriptionBillingCycle.MONTHLY,
                    price_multiplier=1.25,
                    is_default=True,
                    display_order=0,
                )
            ],
        )

        created = await service.create_product(
            ProductCreate(
                slug="configurable",
                title="Configurable Campaign",
                description="Flexible merchandising",
                category="flex",
                basePrice=300.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
                channelEligibility=["storefront"],
                configuration=configuration,
            )
        )

        assert created.option_groups and len(created.option_groups[0].options) == 2
        assert float(created.option_groups[0].options[0].price_delta) == 15.0
        assert created.add_ons and created.add_ons[0].is_recommended is True
        assert created.custom_fields and created.custom_fields[0].is_required is True
        assert created.subscription_plans and created.subscription_plans[0].billing_cycle == ProductSubscriptionBillingCycleEnum.MONTHLY

        patch_configuration = ProductConfigurationMutation(add_ons=[])
        patched = await service.update_product(created, ProductUpdate(configuration=patch_configuration))

        assert patched.option_groups and len(patched.option_groups[0].options) == 2
        assert patched.add_ons == []
