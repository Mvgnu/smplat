from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from smplat_api.models import Product
from smplat_api.models.customer_profile import CurrencyEnum
from smplat_api.models.product import (
    JourneyComponent,
    ProductAddOn,
    ProductAuditLog,
    ProductCustomField,
    ProductJourneyComponent,
    ProductMediaAsset,
    ProductOption,
    ProductOptionGroup,
    ProductOptionGroupTypeEnum,
    ProductSubscriptionPlan,
    ProductSubscriptionBillingCycleEnum,
    ProductStatusEnum,
    ProductCustomFieldTypeEnum,
)
from smplat_api.schemas.product import (
    ProductConfigurationMutation,
    ProductConfigurationPreset,
    ProductCreate,
    ProductUpdate,
)


class ProductService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_products(self) -> Iterable[Product]:
        stmt = select(Product).options(selectinload(Product.media_assets))
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_product_by_id(self, product_id: UUID) -> Product | None:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.option_groups).selectinload(ProductOptionGroup.options),
                selectinload(Product.add_ons),
                selectinload(Product.custom_fields),
                selectinload(Product.subscription_plans),
                selectinload(Product.media_assets),
                selectinload(Product.audit_logs),
                selectinload(Product.journey_components).selectinload(ProductJourneyComponent.component),
            )
            .where(Product.id == product_id)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def get_product_by_slug(self, slug: str) -> Product | None:
        stmt = (
            select(Product)
            .options(
                selectinload(Product.option_groups).selectinload(ProductOptionGroup.options),
                selectinload(Product.add_ons),
                selectinload(Product.custom_fields),
                selectinload(Product.subscription_plans),
                selectinload(Product.media_assets),
                selectinload(Product.audit_logs),
                selectinload(Product.journey_components).selectinload(ProductJourneyComponent.component),
            )
            .where(Product.slug == slug)
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def create_product(self, data: ProductCreate) -> Product:
        existing = await self.get_product_by_slug(data.slug)
        if existing:
            raise ValueError("Product with this slug already exists")

        product = Product(
            id=uuid4(),
            slug=data.slug,
            title=data.title,
            description=data.description,
            category=data.category,
            base_price=Decimal(str(data.base_price)),
            currency=data.currency,
            status=ProductStatusEnum(data.status.value if hasattr(data.status, "value") else data.status),
            channel_eligibility=self._normalize_channels(data.channel_eligibility),
        )

        self._session.add(product)
        await self._session.commit()
        await self._session.refresh(product)
        if data.configuration is not None:
            product = await self.apply_configuration(product, data.configuration, replace_missing=True)
        await self._record_audit(product, action="created", before=None, after=self._serialize_snapshot(product))
        await self._session.commit()
        return product

    async def update_product(self, product: Product, data: ProductUpdate) -> Product:
        before_state = self._serialize_snapshot(product)
        for field in ["title", "description", "category"]:
            value = getattr(data, field)
            if value is not None:
                setattr(product, field, value)

        if data.base_price is not None:
            product.base_price = Decimal(str(data.base_price))

        if data.currency is not None:
            product.currency = data.currency

        if data.status is not None:
            product.status = ProductStatusEnum(data.status.value if hasattr(data.status, "value") else data.status)

        if data.channel_eligibility is not None:
            product.channel_eligibility = self._normalize_channels(data.channel_eligibility)

        await self._session.commit()
        await self._session.refresh(product)

        if data.configuration is not None:
            product = await self.apply_configuration(product, data.configuration, replace_missing=False)

        await self._record_audit(
            product,
            action="updated",
            before=before_state,
            after=self._serialize_snapshot(product),
        )
        await self._session.commit()
        return product

    async def delete_product(self, product_id: UUID) -> None:
        product = await self._session.get(Product, product_id)
        if not product:
            raise ValueError("Product not found")
        before_state = self._serialize_snapshot(product)
        await self._record_audit(
            product,
            action="deleted",
            before=before_state,
            after=None,
        )
        await self._session.delete(product)
        await self._session.commit()

    async def list_audit_logs(self, product_id: UUID) -> list[ProductAuditLog]:
        stmt = (
            select(ProductAuditLog)
            .where(ProductAuditLog.product_id == product_id)
            .order_by(ProductAuditLog.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def restore_from_audit(self, log_id: UUID) -> Product | None:
        log = await self._session.get(ProductAuditLog, log_id)
        if not log or not log.before_snapshot:
            return None

        product = await self.get_product_by_id(log.product_id)
        if not product:
            return None

        snapshot = log.before_snapshot
        product.title = snapshot.get("title", product.title)
        product.description = snapshot.get("description")
        product.category = snapshot.get("category", product.category)
        if (base_price := snapshot.get("base_price")) is not None:
            product.base_price = Decimal(str(base_price))
        currency_value = snapshot.get("currency")
        if currency_value is not None:
            try:
                product.currency = CurrencyEnum(currency_value)
            except ValueError:
                if isinstance(currency_value, str) and currency_value in CurrencyEnum.__members__:
                    product.currency = CurrencyEnum[currency_value]
        status_value = snapshot.get("status")
        if status_value is not None:
            try:
                product.status = ProductStatusEnum(status_value)
            except ValueError:
                if isinstance(status_value, str) and status_value in ProductStatusEnum.__members__:
                    product.status = ProductStatusEnum[status_value]
        if isinstance(snapshot.get("channel_eligibility"), list):
            product.channel_eligibility = self._normalize_channels(snapshot.get("channel_eligibility") or [])

        previous_after_snapshot = None
        if log.after_snapshot is not None:
            if isinstance(log.after_snapshot, dict):
                previous_after_snapshot = dict(log.after_snapshot)
            else:
                previous_after_snapshot = log.after_snapshot

        await self._session.commit()
        await self._session.refresh(product)
        await self._record_audit(
            product,
            action="restored",
            before=previous_after_snapshot,
            after=self._serialize_snapshot(product),
        )
        await self._session.commit()
        return product

    async def attach_media_asset(
        self,
        product: Product,
        *,
        label: str | None,
        asset_url: str,
        storage_key: str | None,
        client_id: str | None = None,
        display_order: int | None = None,
        is_primary: bool | None = None,
        usage_tags: list[str] | None = None,
        alt_text: str | None = None,
        checksum: str | None = None,
        metadata: dict | None = None,
    ) -> ProductMediaAsset:
        asset = ProductMediaAsset(
            id=uuid4(),
            product_id=product.id,
            label=label,
            asset_url=asset_url,
            storage_key=storage_key,
            client_id=client_id,
            display_order=display_order if display_order is not None else 0,
            is_primary=bool(is_primary) if is_primary is not None else False,
            usage_tags=list(usage_tags or []),
            alt_text=alt_text,
            checksum=checksum,
            metadata_json=metadata or {},
        )
        self._session.add(asset)
        await self._session.commit()
        await self._session.refresh(asset)
        await self._session.refresh(product)
        await self._record_audit(
            product,
            action="updated",
            before=None,
            after={"media_asset_id": str(asset.id), "asset_url": asset.asset_url},
        )
        await self._session.commit()
        return asset

    async def remove_media_asset(self, asset_id: UUID) -> None:
        asset = await self._session.get(ProductMediaAsset, asset_id)
        if not asset:
            return
        product = await self.get_product_by_id(asset.product_id)
        before_state = {"media_asset_id": str(asset.id), "asset_url": asset.asset_url}
        await self._session.delete(asset)
        await self._session.commit()
        if product:
            await self._record_audit(
                product,
                action="updated",
                before=before_state,
                after=None,
            )
            await self._session.commit()

    def _normalize_channels(self, value: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        normalized: list[str] = []
        for entry in value:
            if not isinstance(entry, str):
                continue
            channel = entry.strip().lower()
            if not channel or channel in seen:
                continue
            seen.add(channel)
            normalized.append(channel)
        return normalized

    async def _record_audit(
        self,
        product: Product,
        *,
        action: str,
        before: dict | None,
        after: dict | None,
    ) -> None:
        if not getattr(product, "id", None):
            return
        log = ProductAuditLog(
            id=uuid4(),
            product_id=product.id,
            action=action,
            before_snapshot=before,
            after_snapshot=after,
        )
        self._session.add(log)
        await self._session.flush()

    def _serialize_snapshot(self, product: Product) -> dict:
        return {
            "title": product.title,
            "description": product.description,
            "category": product.category,
            "base_price": float(product.base_price) if product.base_price is not None else None,
            "currency": product.currency.value
            if isinstance(product.currency, CurrencyEnum)
            else str(product.currency),
            "status": product.status.value
            if isinstance(product.status, ProductStatusEnum)
            else str(product.status),
            "channel_eligibility": list(product.channel_eligibility or []),
        }

    async def apply_configuration(
        self,
        product: Product,
        config: ProductConfigurationMutation,
        *,
        replace_missing: bool,
    ) -> Product:
        if config is None:
            return product

        async def _mutate() -> None:
            await self._session.refresh(
                product,
                attribute_names=[
                    "option_groups",
                    "add_ons",
                    "custom_fields",
                    "subscription_plans",
                    "journey_components",
                ],
            )

            if config.option_groups is not None or replace_missing:
                await self._sync_option_groups(product, list(config.option_groups or []))
            if config.add_ons is not None or replace_missing:
                await self._sync_add_ons(product, list(config.add_ons or []))
            if config.custom_fields is not None or replace_missing:
                await self._sync_custom_fields(product, list(config.custom_fields or []))
            if config.subscription_plans is not None or replace_missing:
                await self._sync_subscription_plans(product, list(config.subscription_plans or []))
            if config.configuration_presets is not None or replace_missing:
                product.configuration_presets = self._serialize_configuration_presets(
                    product, list(config.configuration_presets or [])
                )
            if config.journey_components is not None or replace_missing:
                await self._sync_journey_components(product, list(config.journey_components or []))

            await self._record_audit(
                product,
                action="configuration_updated",
                before=None,
                after={
                    "option_groups": len(product.option_groups),
                    "add_ons": len(product.add_ons),
                    "custom_fields": len(product.custom_fields),
                    "subscription_plans": len(product.subscription_plans),
                    "journey_components": len(product.journey_components),
                },
            )

        if self._session.in_transaction():
            await _mutate()
        else:
            async with self._session.begin():
                await _mutate()

        await self._session.flush()
        self._session.expire(
            product,
            attribute_names=[
                "option_groups",
                "add_ons",
                "custom_fields",
                "subscription_plans",
                "journey_components",
            ],
        )

        return await self.get_product_by_id(product.id) or product

    async def _sync_option_groups(
        self,
        product: Product,
        payload: list["ProductOptionGroupWrite"],
    ) -> None:
        from smplat_api.schemas.product import ProductOptionGroupWrite  # avoid circular import

        groups_by_id: dict[str, ProductOptionGroup] = {
            str(group.id): group for group in list(product.option_groups)
        }
        seen_ids: set[str] = set()

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductOptionGroupWrite)
            key = str(incoming.id) if incoming.id else None
            group = groups_by_id.get(key or "") if key else None
            if group is None:
                group = ProductOptionGroup(
                    id=uuid4(),
                    product_id=product.id,
                )
                self._session.add(group)
                product.option_groups.append(group)

            group.name = incoming.name
            group.description = incoming.description
            group.group_type = ProductOptionGroupTypeEnum(
                incoming.group_type.value
                if hasattr(incoming.group_type, "value")
                else str(incoming.group_type)
            )
            group.is_required = incoming.is_required
            group.display_order = incoming.display_order if incoming.display_order is not None else index
            group.metadata_json = incoming.metadata or {}

            await self._sync_options(group, incoming.options or [])

            seen_ids.add(str(group.id))

        for group in list(product.option_groups):
            if str(group.id) not in seen_ids:
                product.option_groups.remove(group)
                await self._session.delete(group)

    async def _sync_options(self, group: ProductOptionGroup, payload: list["ProductOptionWrite"]) -> None:
        from smplat_api.schemas.product import ProductOptionWrite

        options_by_id: dict[str, ProductOption] = {str(option.id): option for option in list(group.options)}
        seen_ids: set[str] = set()

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductOptionWrite)
            key = str(incoming.id) if incoming.id else None
            option = options_by_id.get(key or "") if key else None
            if option is None:
                option = ProductOption(id=uuid4(), group_id=group.id)
                self._session.add(option)
                group.options.append(option)

            option.name = incoming.name
            option.description = incoming.description
            option.price_delta = Decimal(str(incoming.price_delta))
            option.metadata_json = (
                incoming.metadata.model_dump(by_alias=True, exclude_none=True)
                if incoming.metadata
                else {}
            )
            option.display_order = incoming.display_order if incoming.display_order is not None else index

            seen_ids.add(str(option.id))

        for option in list(group.options):
            if str(option.id) not in seen_ids:
                group.options.remove(option)
                await self._session.delete(option)

    async def _sync_add_ons(self, product: Product, payload: list["ProductAddOnWrite"]) -> None:
        from smplat_api.schemas.product import ProductAddOnWrite

        add_ons_by_id: dict[str, ProductAddOn] = {str(add_on.id): add_on for add_on in list(product.add_ons)}
        seen_ids: set[str] = set()

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductAddOnWrite)
            key = str(incoming.id) if incoming.id else None
            add_on = add_ons_by_id.get(key or "") if key else None
            if add_on is None:
                add_on = ProductAddOn(id=uuid4(), product_id=product.id)
                self._session.add(add_on)
                product.add_ons.append(add_on)

            add_on.label = incoming.label
            add_on.description = incoming.description
            add_on.price_delta = Decimal(str(incoming.price_delta))
            add_on.is_recommended = incoming.is_recommended
            add_on.display_order = incoming.display_order if incoming.display_order is not None else index
            add_on.metadata_json = (
                incoming.metadata.model_dump(by_alias=True, exclude_none=True)
                if incoming.metadata
                else {}
            )

            seen_ids.add(str(add_on.id))

        for add_on in list(product.add_ons):
            if str(add_on.id) not in seen_ids:
                product.add_ons.remove(add_on)
                await self._session.delete(add_on)

    async def _sync_custom_fields(
        self,
        product: Product,
        payload: list["ProductCustomFieldWrite"],
    ) -> None:
        from smplat_api.schemas.product import ProductCustomFieldWrite

        fields_by_id: dict[str, ProductCustomField] = {
            str(field.id): field for field in list(product.custom_fields)
        }
        seen_ids: set[str] = set()

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductCustomFieldWrite)
            key = str(incoming.id) if incoming.id else None
            field = fields_by_id.get(key or "") if key else None
            if field is None:
                field = ProductCustomField(id=uuid4(), product_id=product.id)
                self._session.add(field)
                product.custom_fields.append(field)

            field.label = incoming.label
            field.field_type = ProductCustomFieldTypeEnum(
                incoming.field_type.value
                if hasattr(incoming.field_type, "value")
                else str(incoming.field_type)
            )
            field.placeholder = incoming.placeholder
            field.help_text = incoming.help_text
            field.is_required = incoming.is_required
            field.display_order = incoming.display_order if incoming.display_order is not None else index
            field.metadata_json = (
                incoming.metadata.model_dump(by_alias=True, exclude_none=True)
                if incoming.metadata
                else {}
            )

            seen_ids.add(str(field.id))

        for field in list(product.custom_fields):
            if str(field.id) not in seen_ids:
                product.custom_fields.remove(field)
                await self._session.delete(field)

    async def _sync_subscription_plans(
        self,
        product: Product,
        payload: list["ProductSubscriptionPlanWrite"],
    ) -> None:
        from smplat_api.schemas.product import ProductSubscriptionPlanWrite

        plans_by_id: dict[str, ProductSubscriptionPlan] = {
            str(plan.id): plan for plan in list(product.subscription_plans)
        }
        seen_ids: set[str] = set()

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductSubscriptionPlanWrite)
            key = str(incoming.id) if incoming.id else None
            plan = plans_by_id.get(key or "") if key else None
            if plan is None:
                plan = ProductSubscriptionPlan(id=uuid4(), product_id=product.id)
                self._session.add(plan)
                product.subscription_plans.append(plan)

            plan.label = incoming.label
            plan.description = incoming.description
            plan.billing_cycle = ProductSubscriptionBillingCycleEnum(
                incoming.billing_cycle.value
                if hasattr(incoming.billing_cycle, "value")
                else str(incoming.billing_cycle)
            )
            plan.price_multiplier = (
                Decimal(str(incoming.price_multiplier)) if incoming.price_multiplier is not None else None
            )
            plan.price_delta = (
                Decimal(str(incoming.price_delta)) if incoming.price_delta is not None else None
            )
            plan.is_default = incoming.is_default
            plan.display_order = incoming.display_order if incoming.display_order is not None else index

            seen_ids.add(str(plan.id))

        for plan in list(product.subscription_plans):
            if str(plan.id) not in seen_ids:
                product.subscription_plans.remove(plan)
                await self._session.delete(plan)

    async def _sync_journey_components(
        self,
        product: Product,
        payload: list["ProductJourneyComponentWrite"],
    ) -> None:
        from smplat_api.schemas.product import ProductJourneyComponentWrite

        links_by_id: dict[str, ProductJourneyComponent] = {
            str(link.id): link for link in list(product.journey_components)
        }
        links_by_component: dict[str, ProductJourneyComponent] = {
            str(link.component_id): link for link in list(product.journey_components)
        }
        seen_ids: set[str] = set()

        component_ids = {incoming.component_id for incoming in payload if incoming.component_id}
        if component_ids:
            result = await self._session.execute(
                select(JourneyComponent.id).where(JourneyComponent.id.in_(component_ids))
            )
            existing_ids = set(result.scalars())
            missing = {component_id for component_id in component_ids if component_id not in existing_ids}
            if missing:
                missing_str = ", ".join(str(component_id) for component_id in sorted(missing, key=str))
                raise ValueError(f"Unknown journey components: {missing_str}")

        for index, incoming in enumerate(payload):
            assert isinstance(incoming, ProductJourneyComponentWrite)
            link: ProductJourneyComponent | None = None
            key = str(incoming.id) if incoming.id else None
            if key:
                link = links_by_id.get(key)
            if link is None:
                link = links_by_component.get(str(incoming.component_id))
                if link and str(link.id) in seen_ids:
                    link = None
            if link is None:
                link = ProductJourneyComponent(id=uuid4(), product_id=product.id)
                self._session.add(link)
                product.journey_components.append(link)

            link.component_id = incoming.component_id
            link.display_order = incoming.display_order if incoming.display_order is not None else index
            link.channel_eligibility = list(incoming.channel_eligibility or []) or None
            link.is_required = incoming.is_required if incoming.is_required is not None else False
            link.bindings = [
                binding.model_dump(by_alias=True, exclude_none=True)
                if hasattr(binding, "model_dump")
                else binding
                for binding in (incoming.bindings or [])
            ]
            link.metadata_json = incoming.metadata or {}

            seen_ids.add(str(link.id))

        for link in list(product.journey_components):
            if str(link.id) not in seen_ids:
                product.journey_components.remove(link)
                await self._session.delete(link)

    def _serialize_configuration_presets(
        self,
        product: Product,
        payload: list["ProductConfigurationPreset"],
    ) -> list[dict[str, Any]]:
        if not payload:
            return []

        option_ids_by_group: dict[str, set[str]] = {}
        for group in product.option_groups:
            group_id = str(group.id)
            option_ids_by_group[group_id] = {str(option.id) for option in group.options}

        add_on_ids = {str(add_on.id) for add_on in product.add_ons}
        plan_ids = {str(plan.id) for plan in product.subscription_plans}
        field_ids = {str(field.id) for field in product.custom_fields}

        normalized: list[dict[str, Any]] = []
        for index, preset in enumerate(payload):
            if not isinstance(preset, ProductConfigurationPreset):
                continue

            selection = preset.selection
            option_selections: dict[str, list[str]] = {}
            for group_id, values in selection.option_selections.items():
                if group_id not in option_ids_by_group:
                    continue
                allowed = option_ids_by_group[group_id]
                sanitized = [value for value in values if value in allowed]
                if sanitized:
                    option_selections[group_id] = sanitized

            add_on_selection = [add_on_id for add_on_id in selection.add_on_ids if add_on_id in add_on_ids]

            subscription_plan_id = selection.subscription_plan_id
            if subscription_plan_id is not None and subscription_plan_id not in plan_ids:
                subscription_plan_id = None

            custom_field_values = {
                field_id: str(value)
                for field_id, value in selection.custom_field_values.items()
                if field_id in field_ids and isinstance(value, str)
            }

            normalized.append(
                {
                    "id": str(preset.id) if preset.id else str(uuid4()),
                    "label": preset.label,
                    "summary": preset.summary,
                    "heroImageUrl": preset.hero_image_url,
                    "badge": preset.badge,
                    "priceHint": preset.price_hint,
                    "displayOrder": preset.display_order if preset.display_order is not None else index,
                    "selection": {
                        "optionSelections": option_selections,
                        "addOnIds": add_on_selection,
                        "subscriptionPlanId": subscription_plan_id,
                        "customFieldValues": custom_field_values,
                    },
                }
            )

        return normalized
