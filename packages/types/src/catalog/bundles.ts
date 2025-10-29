export type CatalogBundleComponentApi = {
  slug: string;
  quantity?: number | null;
};

export type CatalogBundleApi = {
  id: string;
  primaryProductSlug: string;
  bundleSlug: string;
  title: string;
  description?: string | null;
  savingsCopy?: string | null;
  cmsPriority: number;
  components: CatalogBundleComponentApi[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CatalogBundle = {
  id: string;
  primaryProductSlug: string;
  bundleSlug: string;
  title: string;
  description: string | null;
  savingsCopy: string | null;
  cmsPriority: number;
  components: CatalogBundleComponent[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type CatalogBundleComponent = {
  slug: string;
  quantity: number | null;
};

export function normalizeCatalogBundle(payload: CatalogBundleApi): CatalogBundle {
  return {
    id: payload.id,
    primaryProductSlug: payload.primaryProductSlug,
    bundleSlug: payload.bundleSlug,
    title: payload.title,
    description: payload.description ?? null,
    savingsCopy: payload.savingsCopy ?? null,
    cmsPriority: payload.cmsPriority,
    components: payload.components.map((component) => ({
      slug: component.slug,
      quantity: component.quantity ?? null,
    })),
    metadata: payload.metadata ?? {},
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
  };
}
