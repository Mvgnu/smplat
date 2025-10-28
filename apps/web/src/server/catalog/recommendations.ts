import "server-only";

import {
  type CatalogRecommendationResponse,
  type CatalogRecommendationResponseApi,
  normalizeCatalogRecommendation,
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey =
  process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

export async function fetchCatalogBundleRecommendations(
  productSlug: string,
): Promise<CatalogRecommendationResponse> {
  const fallback: CatalogRecommendationResponse = {
    productSlug,
    resolvedAt: new Date(),
    freshnessMinutes: null,
    cacheLayer: checkoutApiKey ? "error" : "unauthorized",
    fallbackCopy: "Dynamic merchandising signals are calibrating – showing static bundles.",
    recommendations: [],
  };

  if (!checkoutApiKey) {
    return fallback;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/catalog/recommendations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": checkoutApiKey,
      },
      cache: "no-store",
      body: JSON.stringify({
        product_slug: productSlug,
        freshness_minutes: 10,
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const payload = (await response.json()) as CatalogRecommendationResponseApi;
    const normalized = normalizeCatalogRecommendation(payload);
    return normalized;
  } catch (error) {
    console.warn("Failed to fetch catalog bundle recommendations", error);
    return fallback;
  }
}
