import "server-only";

type CatalogSearchSnapshot = {
  totals?: Record<string, number>;
  categories?: Record<string, number>;
  sorts?: Record<string, number>;
  queries?: Record<string, number>;
  zero_result_queries?: Record<string, number>;
  metrics?: {
    zero_results_rate?: number;
    average_results_per_search?: number;
  };
  events?: {
    last_query: string | null;
    last_category: string | null;
    last_sort: string | null;
    last_results_count: number | null;
    last_search_at: string | null;
    recent: Array<{
      query: string | null;
      category: string | null;
      sort: string | null;
      results_count: number;
      recorded_at: string;
    }>;
  };
};

export type CatalogInsights = {
  trendingQueries: Array<{ query: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  zeroResultQueries: Array<{ query: string; count: number }>;
  averageResultsPerSearch: number | null;
  zeroResultsRate: number | null;
  totalSearches: number;
  zeroResults: number;
  sampleSize: number;
  lastSearchAt: Date | null;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const emptyInsights: CatalogInsights = {
  trendingQueries: [],
  topCategories: [],
  zeroResultQueries: [],
  averageResultsPerSearch: null,
  zeroResultsRate: null,
  totalSearches: 0,
  zeroResults: 0,
  sampleSize: 0,
  lastSearchAt: null,
};

export async function fetchCatalogSearchInsights(): Promise<CatalogInsights> {
  if (!checkoutApiKey) {
    return emptyInsights;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/observability/catalog-search`, {
      headers: {
        "X-API-Key": checkoutApiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return emptyInsights;
    }

    const payload = (await response.json()) as CatalogSearchSnapshot;

    const trendingQueries = Object.entries(payload.queries ?? {})
      .map(([query, count]) => ({ query, count }))
      .filter((entry) => entry.query.trim().length > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topCategories = Object.entries(payload.categories ?? {})
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const zeroResultQueries = Object.entries(payload.zero_result_queries ?? {})
      .map(([query, count]) => ({ query, count }))
      .filter((entry) => entry.query.trim().length > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const recentEvents = payload.events?.recent ?? [];
    const sampleSize = recentEvents.length;

    const totals = payload.totals ?? {};
    const metrics = payload.metrics ?? {};

    const searchesFromTotals = Number(totals.searches ?? 0);
    const zeroResultsFromTotals = Number(totals.zero_results ?? 0);
    const resultsReturnedFromTotals = Number(totals.results_returned ?? 0);

    let zeroResultsRate =
      typeof metrics.zero_results_rate === "number" ? metrics.zero_results_rate : null;
    if (zeroResultsRate === null && searchesFromTotals > 0) {
      zeroResultsRate = zeroResultsFromTotals / searchesFromTotals;
    }
    if (zeroResultsRate === null && sampleSize > 0) {
      const zeroResultsFromSample = recentEvents.filter((event) => event.results_count === 0).length;
      zeroResultsRate = zeroResultsFromSample / sampleSize;
    }

    let averageResults =
      typeof metrics.average_results_per_search === "number"
        ? metrics.average_results_per_search
        : null;
    if (averageResults === null && searchesFromTotals > 0) {
      averageResults = resultsReturnedFromTotals / searchesFromTotals;
    }
    if (averageResults === null && sampleSize > 0) {
      const resultsFromSample = recentEvents.reduce(
        (sum, event) => sum + event.results_count,
        0
      );
      averageResults = resultsFromSample / sampleSize;
    }

    const derivedZeroResults =
      zeroResultsFromTotals || recentEvents.filter((event) => event.results_count === 0).length;
    const derivedSearches = searchesFromTotals || sampleSize;

    return {
      trendingQueries,
      topCategories,
      zeroResultQueries,
      totalSearches: derivedSearches,
      zeroResults: derivedZeroResults,
      sampleSize,
      zeroResultsRate,
      averageResultsPerSearch: averageResults,
      lastSearchAt: payload.events?.last_search_at ? new Date(payload.events.last_search_at) : null,
    };
  } catch (error) {
    console.warn("Failed to fetch catalog observability snapshot", error);
    return emptyInsights;
  }
}
