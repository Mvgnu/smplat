import "server-only";

// meta: module: catalog-bundles

import {
  type CatalogBundle,
  type CatalogBundleApi,
  normalizeCatalogBundle,
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

const fallbackBundle: CatalogBundle = {
  id: "bundle-local-placeholder",
  primaryProductSlug: "demo-product",
  bundleSlug: "demo-bundle",
  title: "Demo merchandising bundle",
  description: "Local development fallback bundle.",
  savingsCopy: "Save 10% with this curated add-on stack",
  cmsPriority: 100,
  components: [
    { slug: "demo-upgrade", quantity: 1 },
    { slug: "demo-coaching", quantity: 1 },
  ],
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

export async function fetchCatalogBundles(): Promise<CatalogBundle[]> {
  if (!apiKeyHeader) {
    return [fallbackBundle];
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/catalog/bundles`, {
    cache: "no-store",
    headers: defaultHeaders,
  });

  if (!response.ok) {
    throw new Error(`Failed to load catalog bundles: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as CatalogBundleApi[];
  return payload.map(normalizeCatalogBundle);
}

export type UpsertBundleInput = {
  id?: string;
  primaryProductSlug: string;
  bundleSlug: string;
  title: string;
  description?: string | null;
  savingsCopy?: string | null;
  cmsPriority: number;
  components: { slug: string; quantity?: number | null }[];
  metadata?: Record<string, unknown>;
};

export async function upsertCatalogBundle(input: UpsertBundleInput): Promise<CatalogBundle> {
  if (!apiKeyHeader) {
    return {
      ...fallbackBundle,
      ...input,
      description: input.description ?? null,
      savingsCopy: input.savingsCopy ?? null,
      components: input.components.map((component) => ({
        slug: component.slug,
        quantity: component.quantity ?? null
      })),
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  const targetUrl = input.id
    ? `${apiBaseUrl}/api/v1/catalog/bundles/${input.id}`
    : `${apiBaseUrl}/api/v1/catalog/bundles`;
  const method = input.id ? "PATCH" : "POST";
  const response = await fetch(targetUrl, {
    method,
    headers: defaultHeaders,
    body: JSON.stringify({
      primaryProductSlug: input.primaryProductSlug,
      bundleSlug: input.bundleSlug,
      title: input.title,
      description: input.description,
      savingsCopy: input.savingsCopy,
      cmsPriority: input.cmsPriority,
      components: input.components,
      metadata: input.metadata ?? {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ${method === "POST" ? "create" : "update"} bundle: ${response.statusText}`);
  }

  const payload = (await response.json()) as CatalogBundleApi;
  return normalizeCatalogBundle(payload);
}

export async function deleteCatalogBundle(bundleId: string): Promise<void> {
  if (!apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/catalog/bundles/${bundleId}`, {
    method: "DELETE",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete bundle: ${response.statusText}`);
  }
}
