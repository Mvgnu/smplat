from __future__ import annotations

from decimal import Decimal

import pytest

from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import ProductStatusEnum, ProductSubscriptionBillingCycleEnum
from smplat_api.schemas.product import (
    ProductAddOnMetadata,
    ProductAddOnPricing,
    ProductAddOnWrite,
    ProductConfigurationMutation,
    ProductConfigurationPreset,
    ProductConfigurationPresetSelection,
    ProductCreate,
    ProductCustomFieldMetadata,
    ProductCustomFieldRegexRule,
    ProductCustomFieldRegexTester,
    ProductCustomFieldType,
    ProductCustomFieldValidationRules,
    ProductCustomFieldWrite,
    ProductOptionGroupType,
    ProductOptionGroupWrite,
    ProductOptionWrite,
    ProductSubscriptionBillingCycle,
    ProductSubscriptionPlanWrite,
    ProductUpdate,
    _build_add_on_pricing_snapshot,
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
                    metadata=ProductAddOnMetadata(
                        pricing=ProductAddOnPricing(mode="percentage", amount=0.1)
                    ),
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
        assert created.add_ons[0].metadata_json is not None
        assert created.add_ons[0].metadata_json.get("pricing", {}).get("mode") == "percentage"
        assert created.custom_fields and created.custom_fields[0].is_required is True
        assert created.subscription_plans and created.subscription_plans[0].billing_cycle == ProductSubscriptionBillingCycleEnum.MONTHLY

        patch_configuration = ProductConfigurationMutation(add_ons=[])
        patched = await service.update_product(created, ProductUpdate(configuration=patch_configuration))

        assert patched.option_groups and len(patched.option_groups[0].options) == 2
        assert patched.add_ons == []


@pytest.mark.asyncio
async def test_custom_field_metadata_round_trip(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        configuration = ProductConfigurationMutation(
            custom_fields=[
                ProductCustomFieldWrite(
                    label="Hero URL",
                    field_type=ProductCustomFieldType.TEXT,
                    is_required=True,
                    display_order=0,
                    metadata=ProductCustomFieldMetadata(
                        helper_text="Share the published landing page.",
                        sample_values=["https://brand.example/brief"],
                        validation=ProductCustomFieldValidationRules(
                            min_length=5,
                            max_length=120,
                            pattern="^https://",
                            regex=ProductCustomFieldRegexRule(
                                pattern="^https://",
                                flags="i",
                                description="Only secure URLs are accepted.",
                            ),
                            allowed_values=["https://brand.example/brief"],
                        ),
                        regex_tester=ProductCustomFieldRegexTester(
                            sample_value="https://brand.example/brief",
                            last_result=True,
                        ),
                    ),
                )
            ]
        )

        product = await service.create_product(
            ProductCreate(
                slug="field-metadata",
                title="Field Metadata Product",
                description="Validates metadata persistence",
                category="meta",
                basePrice=75.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
                configuration=configuration,
            )
        )

        assert product.custom_fields
        field = product.custom_fields[0]
        assert field.metadata_json is not None
        assert field.metadata_json.get("helperText") == "Share the published landing page."
        assert field.metadata_json.get("sampleValues") == ["https://brand.example/brief"]
        validation_meta = field.metadata_json.get("validation")
        assert validation_meta is not None
        assert validation_meta.get("pattern") == "^https://"
        assert validation_meta.get("regex", {}).get("flags") == "i"
        regex_tester = field.metadata_json.get("regexTester")
        assert regex_tester is not None
        assert regex_tester.get("sampleValue") == "https://brand.example/brief"
        assert regex_tester.get("lastResult") is True


def test_build_add_on_pricing_snapshot_includes_service_rules():
    from datetime import datetime, timezone

    from smplat_api.domain.fulfillment import provider_registry
    from smplat_api.domain.fulfillment.provider_registry import (
        FulfillmentProviderDescriptor,
        FulfillmentServiceDescriptor,
        _CatalogSnapshot,
    )

    original_catalog = provider_registry._CATALOG
    provider = FulfillmentProviderDescriptor(id="prov-1", name="Provider One", region="us")
    service = FulfillmentServiceDescriptor(
        id="svc-test",
        provider_id="prov-1",
        name="Test Service",
        action="launch",
        default_currency="USD",
        metadata={"costModel": {"kind": "flat", "amount": 50}},
    )
    provider_registry._CATALOG = _CatalogSnapshot(
        providers={provider.id: provider},
        services={service.id: service},
        loaded_at=datetime.now(timezone.utc),
    )

    try:
        metadata = ProductAddOnMetadata(
            pricing=ProductAddOnPricing(
                mode="serviceOverride",
                serviceId="svc-test",
                amount=125,
                previewQuantity=150,
                rules=[
                    {
                        "id": "rule-1",
                        "conditions": [{"kind": "channel", "channels": ["storefront"]}],
                        "overrides": {"providerId": "prov-1", "marginTarget": 0.25},
                    }
                ],
            )
        )

        snapshot, computed_delta, _ = _build_add_on_pricing_snapshot(metadata, fallback_delta=90)
        assert snapshot is not None
        assert snapshot["serviceId"] == "svc-test"
        assert computed_delta == 125
        assert snapshot["serviceRules"][0]["conditions"][0]["channels"] == ["storefront"]
    finally:
        provider_registry._CATALOG = original_catalog


@pytest.mark.asyncio
async def test_attach_media_asset_persists_metadata(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        product = await service.create_product(
            ProductCreate(
                slug="asset-capture",
                title="Asset Capture",
                description="Validates gallery persistence",
                category="gallery",
                basePrice=50.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
            )
        )

        db_product = await service.get_product_by_id(product.id)
        assert db_product is not None

        asset = await service.attach_media_asset(
            db_product,
            label="Hero shot",
            asset_url="https://cdn.dev/products/asset-capture/hero.jpg",
            storage_key="products/asset-capture/hero.jpg",
            client_id="hero-0",
            display_order=2,
            is_primary=True,
            usage_tags=["hero", "social"],
            alt_text="Hero conversion shot",
            checksum="sha256:abc123",
            metadata={"pixelWidth": 2048, "pixelHeight": 1365},
        )

        assert asset.client_id == "hero-0"
        assert asset.display_order == 2
        assert asset.is_primary is True
        assert asset.usage_tags == ["hero", "social"]
        assert asset.alt_text == "Hero conversion shot"
        assert asset.checksum == "sha256:abc123"
        assert asset.metadata_json["pixelWidth"] == 2048

        refreshed = await service.get_product_by_id(product.id)
        assert refreshed is not None
        assert refreshed.media_assets
        persisted = refreshed.media_assets[0]
        assert persisted.client_id == "hero-0"
        assert persisted.display_order == 2
        assert persisted.is_primary is True
        assert persisted.usage_tags == ["hero", "social"]
        assert persisted.alt_text == "Hero conversion shot"
        assert persisted.checksum == "sha256:abc123"


@pytest.mark.asyncio
async def test_configuration_presets_roundtrip(session_factory):
    async with session_factory() as session:
        service = ProductService(session)

        configuration = ProductConfigurationMutation(
            option_groups=[
                ProductOptionGroupWrite(
                    name="Platform",
                    group_type=ProductOptionGroupType.SINGLE,
                    is_required=True,
                    display_order=0,
                    options=[
                        ProductOptionWrite(name="Instagram", priceDelta=0, displayOrder=0),
                        ProductOptionWrite(name="TikTok", priceDelta=25, displayOrder=1),
                    ],
                )
            ],
            add_ons=[
                ProductAddOnWrite(label="Boost credits", priceDelta=120, isRecommended=True, displayOrder=0),
            ],
            custom_fields=[
                ProductCustomFieldWrite(
                    label="Brand URL",
                    field_type=ProductCustomFieldType.URL,
                    is_required=True,
                    display_order=0,
                )
            ],
            subscription_plans=[
                ProductSubscriptionPlanWrite(
                    label="Monthly",
                    description="Managed retainer",
                    billing_cycle=ProductSubscriptionBillingCycle.MONTHLY,
                    display_order=0,
                )
            ],
        )

        created = await service.create_product(
            ProductCreate(
                slug="preset-product",
                title="Preset Product",
                category="ugc",
                basePrice=200.0,
                currency=CurrencyEnum.EUR,
                status=ProductStatusEnum.ACTIVE,
                configuration=configuration,
            )
        )

        product = await service.get_product_by_id(created.id)
        assert product is not None

        group = product.option_groups[0]
        option = group.options[0]
        add_on = product.add_ons[0]
        field = product.custom_fields[0]
        plan = product.subscription_plans[0]

        preset_mutation = ProductConfigurationMutation(
            configuration_presets=[
                ProductConfigurationPreset(
                    label="Hero bundle",
                    summary="Fast lane",
                    heroImageUrl="https://cdn.example.com/preset.png",
                    badge="Recommended",
                    priceHint="€200 / mo",
                    displayOrder=5,
                    selection=ProductConfigurationPresetSelection(
                        optionSelections={
                            str(group.id): [str(option.id), "missing-option"],
                            "ghost-group": ["ghost-option"],
                        },
                        addOnIds=[str(add_on.id), "missing-addon"],
                        subscriptionPlanId=str(plan.id),
                        customFieldValues={
                            str(field.id): "https://brand.example",
                            "ghost-field": "noop",
                        },
                    ),
                )
            ]
        )

        await service.apply_configuration(product, preset_mutation, replace_missing=False)
        updated = await service.get_product_by_id(product.id)
        assert updated is not None

        presets = updated.configuration_presets
        assert isinstance(presets, list)
        assert len(presets) == 1
        stored = presets[0]

        assert stored["label"] == "Hero bundle"
        assert stored["summary"] == "Fast lane"
        assert stored["displayOrder"] == 5

        selection = stored["selection"]
        assert selection["optionSelections"][str(group.id)] == [str(option.id)]
        assert "ghost-group" not in selection["optionSelections"]
        assert selection["addOnIds"] == [str(add_on.id)]
        assert selection["subscriptionPlanId"] == str(plan.id)
        assert selection["customFieldValues"] == {str(field.id): "https://brand.example"}
