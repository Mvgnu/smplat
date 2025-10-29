from datetime import datetime
from uuid import UUID

from datetime import datetime
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

# meta: schema: catalog-bundle


class CatalogBundleComponent(BaseModel):
    slug: str
    quantity: int | None = None


class CatalogBundleResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    primary_product_slug: str = Field(..., alias="primaryProductSlug")
    bundle_slug: str = Field(..., alias="bundleSlug")
    title: str
    description: str | None = None
    savings_copy: str | None = Field(None, alias="savingsCopy")
    cms_priority: int = Field(..., alias="cmsPriority")
    components: list[CatalogBundleComponent] = Field(default_factory=list)
    metadata: dict = Field(
        default_factory=dict,
        alias="metadata",
        validation_alias=AliasChoices("metadata_json", "metadata"),
    )
    created_at: datetime | None = Field(None, alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")


class CatalogBundleCreate(BaseModel):
    primary_product_slug: str = Field(..., alias="primaryProductSlug")
    bundle_slug: str = Field(..., alias="bundleSlug")
    title: str
    description: str | None = None
    savings_copy: str | None = Field(None, alias="savingsCopy")
    cms_priority: int = Field(100, alias="cmsPriority")
    components: list[CatalogBundleComponent] = Field(default_factory=list)
    metadata: dict | None = None


class CatalogBundleUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    savings_copy: str | None = Field(None, alias="savingsCopy")
    cms_priority: int | None = Field(None, alias="cmsPriority")
    components: list[CatalogBundleComponent] | None = Field(None, alias="components")
    metadata: dict | None = None
