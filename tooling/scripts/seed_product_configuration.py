#!/usr/bin/env python3
# ruff: noqa: E402
"""Seed configurable product data for SMPLAT storefront.

Example:
    DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/smplat \
    python tooling/scripts/seed_product_configuration.py --slug instagram-growth
"""

from __future__ import annotations

import argparse
import os
import sys
from copy import deepcopy
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker


ROOT = os.path.dirname(os.path.dirname(__file__))
API_SRC = os.path.join(ROOT, "..", "apps", "api", "src")
sys.path.append(API_SRC)

from smplat_api.models import (  # noqa: E402  (import after path append)
    Product,
    ProductAddOn,
    ProductCustomField,
    ProductCustomFieldTypeEnum,
    ProductOption,
    ProductOptionGroup,
    ProductOptionGroupTypeEnum,
    ProductStatusEnum,
    ProductSubscriptionPlan,
    ProductSubscriptionBillingCycleEnum,
)
from smplat_api.models.fulfillment import FulfillmentTaskTypeEnum  # noqa: E402

from smplat_api.core.settings import Settings  # noqa: E402
from sqlalchemy import create_engine


DEFAULT_SLUG = "instagram-growth"

OPTION_GROUPS = [
    {
        "name": "Campaign tier",
        "description": "Select the tier that best matches your growth targets.",
        "group_type": ProductOptionGroupTypeEnum.SINGLE,
        "is_required": True,
        "options": [
            {
                "label": "Essentials (4-week sprint)",
                "description": "Best for testing a new niche or validating product positioning.",
                "price_delta": Decimal("0"),
                "display_order": 0,
                "metadata_json": {"recommended": True},
            },
            {
                "label": "Scale (8-week program)",
                "description": "Balanced experiments, live reporting, and advanced automation tuning.",
                "price_delta": Decimal("450"),
                "display_order": 1,
            },
            {
                "label": "Dominance (12-week takeover)",
                "description": "Aggressive funnel, influencer collaborations, and creative production credits.",
                "price_delta": Decimal("980"),
                "display_order": 2,
            },
        ],
    },
    {
        "name": "Experiment focus areas",
        "description": "Choose the levers we emphasize during the campaign (pick as many as applicable).",
        "group_type": ProductOptionGroupTypeEnum.MULTIPLE,
        "is_required": False,
        "options": [
            {"label": "UGC & reels production", "price_delta": Decimal("180"), "display_order": 0},
            {"label": "Influencer collaborations", "price_delta": Decimal("250"), "display_order": 1},
            {"label": "Paid spike amplification", "price_delta": Decimal("320"), "display_order": 2},
            {"label": "Community management", "price_delta": Decimal("160"), "display_order": 3},
        ],
    },
]

ADD_ONS = [
    {
        "label": "Creative lab: 10 custom assets",
        "description": "Carousel, reels, and story templates aligned to campaign narrative.",
        "price_delta": Decimal("420"),
        "is_recommended": True,
        "display_order": 0,
    },
    {
        "label": "Influencer whitelist management",
        "description": "We handle outreach, vetting, and briefing for paid collaborations.",
        "price_delta": Decimal("560"),
        "display_order": 1,
    },
    {
        "label": "Executive-ready reporting pack",
        "description": "Weekly KPI recap deck plus insights you can share with stakeholders.",
        "price_delta": Decimal("190"),
        "display_order": 2,
    },
]

CUSTOM_FIELDS = [
    {
        "label": "Instagram handle",
        "field_type": ProductCustomFieldTypeEnum.TEXT,
        "placeholder": "@yourbrand",
        "help_text": "No password required. We'll request access securely post-purchase.",
        "is_required": True,
        "display_order": 0,
    },
    {
        "label": "Primary campaign objective",
        "field_type": ProductCustomFieldTypeEnum.TEXT,
        "placeholder": "e.g., Launch new product line, grow community",
        "is_required": True,
        "display_order": 1,
    },
    {
        "label": "Preferred landing page URL",
        "field_type": ProductCustomFieldTypeEnum.URL,
        "placeholder": "https://example.com",
        "help_text": "Used for call-to-action placements and tracking.",
        "is_required": False,
        "display_order": 2,
    },
]

SUBSCRIPTION_PLANS = [
    {
        "label": "One-time sprint",
        "description": "Single campaign engagement, perfect for launch support.",
        "billing_cycle": ProductSubscriptionBillingCycleEnum.ONE_TIME,
        "is_default": True,
        "display_order": 0,
    },
    {
        "label": "Quarterly partnership",
        "description": "Continuous optimization with quarterly strategy intensives.",
        "billing_cycle": ProductSubscriptionBillingCycleEnum.QUARTERLY,
        "price_multiplier": Decimal("2.6"),
        "price_delta": Decimal("-150"),
        "display_order": 1,
    },
    {
        "label": "Annual growth retainer",
        "description": "Priority roadmap, dedicated analysts, and VIP support channel.",
        "billing_cycle": ProductSubscriptionBillingCycleEnum.ANNUAL,
        "price_multiplier": Decimal("9.5"),
        "price_delta": Decimal("-600"),
        "display_order": 2,
    },
]

FULFILLMENT_CONFIG = {
    "tasks": [
        {
            "type": FulfillmentTaskTypeEnum.ANALYTICS_COLLECTION.value,
            "title": "Baseline analytics synchronization",
            "description": "Collect current Instagram metrics before campaign automations kick off.",
            "schedule_offset_minutes": 5,
            "max_retries": 3,
            "execution": {
                "kind": "http",
                "method": "POST",
                "url": "{{ env.FULFILLMENT_BASE_URL }}/v1/instagram/analytics/sync",
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer {{ env.FULFILLMENT_ANALYTICS_TOKEN }}",
                    "X-Order-Id": "{{ order.id }}",
                    "X-Order-Number": "{{ order.order_number }}",
                },
                "timeout_seconds": 10,
                "success_statuses": [200, 202],
                "body": {
                    "orderId": "{{ order.id }}",
                    "orderNumber": "{{ order.order_number }}",
                    "productId": "{{ product.id }}",
                    "productSlug": "{{ product.slug }}",
                    "itemId": "{{ item.id }}",
                    "quantity": "{{ item.quantity }}",
                    "selectedOptions": "{{ item.selected_options }}",
                    "attributes": "{{ item.attributes }}",
                },
                "environment_keys": ["FULFILLMENT_BASE_URL", "FULFILLMENT_ANALYTICS_TOKEN"],
            },
            "payload": {
                "playbook": "instagram-baseline-analytics",
            },
        },
        {
            "type": FulfillmentTaskTypeEnum.CONTENT_PROMOTION.value,
            "title": "Campaign activation webhook",
            "description": "Trigger the creative automation pipeline for configured campaign deliverables.",
            "schedule_offset_minutes": 30,
            "max_retries": 5,
            "execution": {
                "kind": "http",
                "method": "POST",
                "url": "{{ env.FULFILLMENT_BASE_URL }}/v1/campaigns/activate",
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer {{ env.FULFILLMENT_ACTIVATION_TOKEN }}",
                },
                "timeout_seconds": 20,
                "success_status_min": 200,
                "success_status_max": 299,
                "body": {
                    "campaign": {
                        "orderId": "{{ order.id }}",
                        "orderNumber": "{{ order.order_number }}",
                        "productTitle": "{{ product.title }}",
                        "currency": "{{ order.currency }}",
                        "total": "{{ order.total }}",
                        "unitPrice": "{{ item.unit_price }}",
                        "quantity": "{{ item.quantity }}",
                    },
                    "customer": {
                        "userId": "{{ order.user_id }}",
                    },
                    "metadata": {
                        "notes": "{{ order.notes }}",
                        "selectedOptions": "{{ item.selected_options }}",
                        "attributes": "{{ item.attributes }}",
                    },
                },
                "environment_keys": [
                    "FULFILLMENT_BASE_URL",
                    "FULFILLMENT_ACTIVATION_TOKEN",
                ],
            },
            "payload": {
                "playbook": "instagram-campaign-activation",
            },
        },
    ]
}


def sync_database_url(async_url: str) -> str:
    if "+asyncpg" in async_url:
        return async_url.replace("+asyncpg", "+psycopg")
    elif "+aiosqlite" in async_url:
        return async_url.replace("+aiosqlite", "")
    return async_url


def seed_configuration(session: Session, product: Product) -> None:
    product.option_groups.clear()
    product.add_ons.clear()
    product.custom_fields.clear()
    product.subscription_plans.clear()
    product.fulfillment_config = deepcopy(FULFILLMENT_CONFIG)

    session.flush()

    for index, group_data in enumerate(OPTION_GROUPS):
        group = ProductOptionGroup(
            product_id=product.id,
            name=group_data["name"],
            description=group_data.get("description"),
            group_type=group_data["group_type"],
            is_required=group_data.get("is_required", False),
            display_order=index,
            metadata_json=None,
        )
        session.add(group)
        session.flush()

        for option_index, option_data in enumerate(group_data["options"]):
            session.add(
                ProductOption(
                    group_id=group.id,
                    name=option_data["label"],
                    description=option_data.get("description"),
                    price_delta=option_data["price_delta"],
                    metadata_json=option_data.get("metadata_json"),
                    display_order=option_data.get("display_order", option_index),
                )
            )

    for add_on_index, add_on in enumerate(ADD_ONS):
        session.add(
            ProductAddOn(
                product_id=product.id,
                label=add_on["label"],
                description=add_on.get("description"),
                price_delta=add_on["price_delta"],
                is_recommended=add_on.get("is_recommended", False),
                display_order=add_on.get("display_order", add_on_index),
            )
        )

    for field_index, field in enumerate(CUSTOM_FIELDS):
        session.add(
            ProductCustomField(
                product_id=product.id,
                label=field["label"],
                field_type=field["field_type"],
                placeholder=field.get("placeholder"),
                help_text=field.get("help_text"),
                is_required=field.get("is_required", False),
                display_order=field.get("display_order", field_index),
            )
        )

    for plan_index, plan in enumerate(SUBSCRIPTION_PLANS):
        session.add(
            ProductSubscriptionPlan(
                product_id=product.id,
                label=plan["label"],
                description=plan.get("description"),
                billing_cycle=plan["billing_cycle"],
                price_multiplier=plan.get("price_multiplier"),
                price_delta=plan.get("price_delta"),
                is_default=plan.get("is_default", False),
                display_order=plan.get("display_order", plan_index),
            )
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed configurable product data")
    parser.add_argument("--slug", default=DEFAULT_SLUG, help="Product slug to seed")
    args = parser.parse_args()

    settings = Settings()
    sync_url = sync_database_url(settings.database_url)
    engine = create_engine(sync_url, future=True)
    SessionLocal = sessionmaker(engine, class_=Session)

    with SessionLocal() as session:
        product = session.execute(select(Product).where(Product.slug == args.slug)).scalar_one_or_none()
        if not product:
            # Create the base product if it doesn't exist
            product = Product(
                slug=args.slug,
                title="Instagram Growth Service",
                description="Professional Instagram growth and engagement service",
                category="social_media",
                base_price=99.00,
                currency="EUR",
                status=ProductStatusEnum.ACTIVE
            )
            session.add(product)
            session.flush()  # Get the product ID
            print(f"Created base product '{args.slug}'")

        seed_configuration(session, product)
        session.commit()

    print(f"Seeded configuration for product '{args.slug}' ✨")


if __name__ == "__main__":
    main()
