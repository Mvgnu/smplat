import "server-only";

// meta: module: catalog-products

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

export type ProductSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  basePrice: number;
  currency: string;
  status: "draft" | "active" | "archived";
  channelEligibility: string[];
  updatedAt: string;
};

export type ProductDetail = ProductSummary & {
  description: string | null;
  mediaAssets: { id: string; assetUrl: string; label: string | null }[];
  auditLog: { id: string; action: string; createdAt: string }[];
};

const fallbackProducts: ProductSummary[] = [
  {
    id: "demo-product",
    slug: "demo-product",
    title: "Demo social launch kit",
    category: "starter",
    basePrice: 199,
    currency: "EUR",
    status: "draft",
    channelEligibility: ["storefront", "loyalty"],
    updatedAt: new Date().toISOString(),
  },
];

export async function fetchProductSummaries(): Promise<ProductSummary[]> {
  if (allowBypass || !apiKeyHeader) {
    return fallbackProducts;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products`, {
    cache: "no-store",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to load products: ${response.statusText}`);
  }

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((item) => ({
    id: String(item.id),
    slug: String(item.slug),
    title: String(item.title),
    category: String(item.category),
    basePrice: Number(item.basePrice ?? item.base_price ?? 0),
    currency: String(item.currency ?? "EUR"),
    status: (item.status as ProductSummary["status"]) ?? "draft",
    channelEligibility: Array.isArray(item.channelEligibility)
      ? (item.channelEligibility as string[])
      : Array.isArray(item.channel_eligibility)
        ? (item.channel_eligibility as string[])
        : [],
    updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
  }));
}

export async function fetchProductDetail(slug: string): Promise<ProductDetail | null> {
  if (allowBypass || !apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return { ...fallback, description: "Fallback product for offline mode", mediaAssets: [], auditLog: [] };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${slug}`, {
    cache: "no-store",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load product: ${response.statusText}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    id: String(payload.id),
    slug: String(payload.slug),
    title: String(payload.title),
    category: String(payload.category),
    description: (payload.description as string | null) ?? null,
    basePrice: Number(payload.basePrice ?? payload.base_price ?? 0),
    currency: String(payload.currency ?? "EUR"),
    status: (payload.status as ProductSummary["status"]) ?? "draft",
    channelEligibility: Array.isArray(payload.channelEligibility)
      ? (payload.channelEligibility as string[])
      : Array.isArray(payload.channel_eligibility)
        ? (payload.channel_eligibility as string[])
        : [],
    updatedAt: String(payload.updatedAt ?? payload.updated_at ?? new Date().toISOString()),
    mediaAssets: Array.isArray(payload.mediaAssets)
      ? (payload.mediaAssets as Array<Record<string, unknown>>).map((asset) => ({
          id: String(asset.id),
          assetUrl: String(asset.assetUrl ?? asset.asset_url ?? ""),
          label: asset.label ? String(asset.label) : null,
        }))
      : [],
    auditLog: Array.isArray(payload.auditLog)
      ? (payload.auditLog as Array<Record<string, unknown>>).map((entry) => ({
          id: String(entry.id),
          action: String(entry.action ?? "updated"),
          createdAt: String(entry.createdAt ?? entry.created_at ?? new Date().toISOString()),
        }))
      : [],
  };
}

export async function updateProductChannels(
  productId: string,
  channelEligibility: string[],
): Promise<ProductSummary> {
  if (allowBypass || !apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return { ...fallback, channelEligibility };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {}),
    },
    body: JSON.stringify({ channelEligibility }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update product channels: ${response.statusText}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    id: String(payload.id),
    slug: String(payload.slug),
    title: String(payload.title),
    category: String(payload.category),
    basePrice: Number(payload.basePrice ?? payload.base_price ?? 0),
    currency: String(payload.currency ?? "EUR"),
    status: (payload.status as ProductSummary["status"]) ?? "draft",
    channelEligibility: Array.isArray(payload.channelEligibility)
      ? (payload.channelEligibility as string[])
      : [],
    updatedAt: String(payload.updatedAt ?? payload.updated_at ?? new Date().toISOString()),
  };
}

export async function updateProductStatus(
  productId: string,
  status: ProductSummary["status"],
): Promise<ProductSummary> {
  if (allowBypass || !apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return { ...fallback, status };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {}),
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update product status: ${response.statusText}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    id: String(payload.id),
    slug: String(payload.slug),
    title: String(payload.title),
    category: String(payload.category),
    basePrice: Number(payload.basePrice ?? payload.base_price ?? 0),
    currency: String(payload.currency ?? "EUR"),
    status: (payload.status as ProductSummary["status"]) ?? "draft",
    channelEligibility: Array.isArray(payload.channelEligibility)
      ? (payload.channelEligibility as string[])
      : [],
    updatedAt: String(payload.updatedAt ?? payload.updated_at ?? new Date().toISOString()),
  };
}

export async function attachProductAsset(
  productId: string,
  assetUrl: string,
  label?: string,
): Promise<void> {
  if (allowBypass || !apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/assets`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ assetUrl, label }),
  });

  if (!response.ok) {
    throw new Error(`Failed to attach product asset: ${response.statusText}`);
  }
}

export async function deleteProductAsset(assetId: string): Promise<void> {
  if (allowBypass || !apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/assets/${assetId}`, {
    method: "DELETE",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete product asset: ${response.statusText}`);
  }
}

export async function restoreProductFromAudit(logId: string): Promise<void> {
  if (allowBypass || !apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/audit/${logId}/restore`, {
    method: "POST",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to restore product from audit: ${response.statusText}`);
  }
}
