import { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { fetchCatalogSearchInsights, type CatalogInsights } from "@/server/observability/catalog-insights";

import { marketingFallbacks } from "./marketing-content";

type Product = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  basePrice: number;
  currency: string;
  status: string;
};

type ProductsPageProps = {
  searchParams?: {
    q?: string;
    category?: string;
    sort?: string;
    platform?: string;
    quickOrderProductId?: string;
    quickOrderProductTitle?: string;
    quickOrderSessionId?: string;
  };
};

type BundleRecommendation = {
  key: string;
  primarySlug: string;
  secondarySlug: string;
  title: string;
  description: string;
  savings?: string;
};

const apiBase =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function recordCatalogSearchTelemetry(params: {
  query?: string | null;
  category?: string | null;
  sort: string;
  resultsCount: number;
}) {
  try {
    await fetch(`${apiBase}/api/v1/observability/catalog-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: params.query ?? null,
        category: params.category ?? null,
        sort: params.sort,
        results_count: params.resultsCount,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.warn("Failed to record catalog search telemetry", error);
  }
}

async function fetchProducts(): Promise<Product[]> {
  try {
    const response = await fetch(`${apiBase}/api/v1/products/`, {
      cache: "no-store",
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.status}`);
    }

    const products = (await response.json()) as Product[];
    return products.filter((product) => product.status.toLowerCase() === "active");
  } catch (error) {
    console.error("Error fetching products:", error);
    return [];
  }
}

export const metadata: Metadata = {
  title: "Social Media Growth Services | SMPLAT",
  description:
    "Professional social media growth services to boost your Instagram presence, increase followers, and enhance engagement.",
  keywords:
    "instagram growth, social media marketing, followers, engagement, instagram promotion",
};

const sortOptions: { value: string; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "title-asc", label: "Title A→Z" },
];

type FiltersProps = {
  categories: string[];
  query?: string;
  selectedCategory?: string;
  selectedSort?: string;
};

function Filters({ categories, query, selectedCategory, selectedSort }: FiltersProps) {
  return (
    <form
      className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur md:flex-row md:items-end md:justify-between"
      role="search"
    >
      <div className="flex flex-1 flex-col gap-2">
        <label className="text-sm text-white/60" htmlFor="q">
          Search
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by service name or description"
          className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white outline-none transition focus:border-white/40"
          type="search"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <label className="text-sm text-white/60" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          name="category"
          defaultValue={selectedCategory ?? ""}
          className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white outline-none transition focus:border-white/40"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <label className="text-sm text-white/60" htmlFor="sort">
          Sort by
        </label>
        <select
          id="sort"
          name="sort"
          defaultValue={selectedSort ?? "featured"}
          className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white outline-none transition focus:border-white/40"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
        >
          Apply
        </button>
        <Link
          href="/products"
          className="rounded-full border border-white/30 px-6 py-2 text-sm font-semibold text-white transition hover:border-white/60"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}

function ProductGrid({
  products,
  highlightProductId,
  quickOrderSessionId,
}: {
  products: Product[];
  highlightProductId?: string | null;
  quickOrderSessionId?: string | null;
}) {
  if (products.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center backdrop-blur">
        <h2 className="text-2xl font-semibold text-white/80">No services match your filters</h2>
        <p className="mt-4 text-white/60">
          Try adjusting your search query or selecting a different category.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => {
        const isHighlighted = highlightProductId === product.id;
        const highlightClass = isHighlighted
          ? "border-emerald-400/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/20"
          : "border-white/10 bg-white/5";
        return (
          <div
            key={product.id}
            id={isHighlighted ? "quick-order-product" : undefined}
            className={`group rounded-3xl border p-8 backdrop-blur transition-all hover:border-white/20 hover:bg-white/10 ${highlightClass}`}
          >
          <div className="mb-6">
            <span className="inline-block rounded-full bg-blue-500/20 px-3 py-1 text-sm font-medium text-blue-300">
              {product.category.charAt(0).toUpperCase() + product.category.slice(1)}
            </span>
          </div>

          <h3 className="text-xl font-semibold">{product.title}</h3>

          {product.description ? (
            <p className="mt-3 line-clamp-3 text-white/70">{product.description}</p>
          ) : (
            <p className="mt-3 text-white/50">
              Tailored growth campaign with configurable options and add-ons.
            </p>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div className="text-2xl font-bold">
              {product.currency} {product.basePrice.toLocaleString()}
            </div>

            <Link
              href={(() => {
                if (!isHighlighted || !quickOrderSessionId) {
                  return `/products/${product.slug}`;
                }
                const params = new URLSearchParams();
                params.set("quickOrderSessionId", quickOrderSessionId);
                return `/products/${product.slug}?${params.toString()}`;
              })()}
              className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              View details
            </Link>
          </div>
          </div>
        );
      })}
    </div>
  );
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function CatalogInsightsSection({
  insights,
  currentQuery,
}: {
  insights: CatalogInsights;
  currentQuery?: string | null;
}) {
  const hasQueries = insights.trendingQueries.length > 0;
  const hasCategories = insights.topCategories.length > 0;
  const hasZeroResultQueries = insights.zeroResultQueries.length > 0;
  const hasMetrics =
    (insights.zeroResultsRate ?? null) !== null ||
    insights.totalSearches > 0 ||
    hasZeroResultQueries;

  if (!hasQueries && !hasCategories && !hasMetrics && !hasZeroResultQueries) {
    return null;
  }

  const lastSearchLabel = insights.lastSearchAt
    ? insights.lastSearchAt.toLocaleString()
    : "Awaiting catalog activity";

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-white backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Catalog telemetry</h2>
          <p className="text-sm text-white/60">
            Live snapshot from the observability pipeline, capturing the last {insights.sampleSize}{" "}
            {insights.sampleSize === 1 ? "search" : "searches"} (total tracked:{" "}
            {insights.totalSearches.toLocaleString()}).
          </p>
        </div>
        <span className="text-xs uppercase tracking-wide text-white/40">Last search: {lastSearchLabel}</span>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <h3 className="text-sm uppercase tracking-wide text-white/50">Trending queries</h3>
          <ul className="mt-3 space-y-2">
            {hasQueries
              ? insights.trendingQueries.map((item, index) => {
                  const isActive = currentQuery ? currentQuery === item.query : false;
                  return (
                    <li
                      key={item.query}
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-white/50">#{index + 1}</span>
                        <span className="font-medium text-white">{item.query}</span>
                        {isActive ? (
                          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                            Viewing
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-white/60">{item.count} searches</span>
                    </li>
                  );
                })
              : [
                  <li
                    key="no-queries"
                    className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/60"
                  >
                    Collecting catalog telemetry—check back once shoppers start searching.
                  </li>,
                ]}
          </ul>
        </div>

        <div className="flex flex-col gap-6 xl:col-span-1">
          <div>
            <h3 className="text-sm uppercase tracking-wide text-white/50">Top categories</h3>
            <ul className="mt-3 space-y-2">
              {hasCategories
                ? insights.topCategories.map((item) => (
                    <li
                      key={item.category}
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80"
                    >
                      <span className="font-medium text-white">
                        {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                      </span>
                      <span className="text-xs text-white/60">{item.count} searches</span>
                    </li>
                  ))
                : [
                    <li
                      key="no-categories"
                      className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/60"
                    >
                      Category insights will appear once catalog browsing begins.
                    </li>,
                  ]}
            </ul>
          </div>

          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-white/80 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/50">Zero-result rate</p>
              <p className="mt-1 text-lg font-semibold text-white">{formatPercent(insights.zeroResultsRate)}</p>
              <p className="text-xs text-white/50">
                {insights.zeroResults.toLocaleString()} zero-result{" "}
                {insights.zeroResults === 1 ? "search" : "searches"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-white/50">Avg results per search</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatNumber(insights.averageResultsPerSearch)}
              </p>
              <p className="text-xs text-white/50">
                Based on {insights.totalSearches.toLocaleString()} tracked{" "}
                {insights.totalSearches === 1 ? "search" : "searches"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/80">
          <div className="flex items-center justify-between">
            <h3 className="text-sm uppercase tracking-wide text-white/50">Zero-result queries</h3>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
              {insights.zeroResults.toLocaleString()} zero-result{" "}
              {insights.zeroResults === 1 ? "search" : "searches"}
            </span>
          </div>
          <p className="text-white/60">
            Use these to seed new bundles, landing pages, or CMS campaigns so shoppers find relevant
            offers.
          </p>
          <ul className="space-y-2">
            {hasZeroResultQueries
              ? insights.zeroResultQueries.map((item) => (
                  <li
                    key={item.query}
                    className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/10 px-4 py-3 text-white"
                  >
                    <span className="font-medium">{item.query}</span>
                    <span className="text-xs text-white/60">{item.count} searches</span>
                  </li>
                ))
              : [
                  <li
                    key="zero-placeholder"
                    className="rounded-2xl border border-white/5 bg-white/10 px-4 py-3 text-white/60"
                  >
                    No zero-result searches detected—catalog coverage looks healthy.
                  </li>,
                ]}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const products = await fetchProducts();
  const categories = Array.from(new Set(products.map((product) => product.category))).sort();

  const query = searchParams?.q?.trim().toLowerCase();
  const category = searchParams?.category?.trim().toLowerCase();
  const sort = searchParams?.sort?.toLowerCase() ?? "featured";
  const quickOrderProductId = searchParams?.quickOrderProductId?.trim();
  const quickOrderProductTitle = searchParams?.quickOrderProductTitle?.trim();
  const quickOrderPlatform = searchParams?.platform?.trim();
  const quickOrderSessionId = searchParams?.quickOrderSessionId?.trim() ?? null;
  const highlightedProduct =
    quickOrderProductId != null
      ? products.find(
          (product) =>
            product.id === quickOrderProductId ||
            product.slug === quickOrderProductId ||
            product.title.toLowerCase() === quickOrderProductId.toLowerCase(),
        ) ?? null
      : null;

  const filteredProducts = products.filter((product) => {
    const matchesCategory = category ? product.category.toLowerCase() === category : true;
    const matchesQuery = query
      ? [product.title, product.description ?? "", product.category]
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true;

    return matchesCategory && matchesQuery;
  });

  const sortedProducts = (() => {
    switch (sort) {
      case "price-asc":
        return filteredProducts.slice().sort((a, b) => a.basePrice - b.basePrice);
      case "price-desc":
        return filteredProducts.slice().sort((a, b) => b.basePrice - a.basePrice);
      case "title-asc":
        return filteredProducts.slice().sort((a, b) => a.title.localeCompare(b.title));
      default:
        return filteredProducts;
    }
  })();

  const bundleRecommendations: BundleRecommendation[] = (() => {
    const map = new Map<string, BundleRecommendation>();
    Object.entries(marketingFallbacks).forEach(([primarySlug, marketing]) => {
      marketing.bundles.forEach((bundle) => {
        const parts = bundle.slug.split("+");
        const secondarySlug =
          parts.find((part) => part !== primarySlug) ?? parts[parts.length - 1] ?? primarySlug;
        const key = [primarySlug, secondarySlug].sort().join("::");
        if (map.has(key)) {
          return;
        }
        map.set(key, {
          key,
          primarySlug,
          secondarySlug,
          title: bundle.title,
          description: bundle.description,
          savings: bundle.savings,
        });
      });
    });
    return Array.from(map.values());
  })();

  await recordCatalogSearchTelemetry({
    query: query ?? null,
    category: category ?? null,
    sort,
    resultsCount: sortedProducts.length,
  });

  const catalogInsights = await fetchCatalogSearchInsights();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 text-white">
      <header className="text-center">
        <h1 className="text-4xl font-bold">Our Services</h1>
        <p className="mt-4 text-xl text-white/70">
          Professional social media growth solutions tailored to your goals.
        </p>
      </header>

      {quickOrderProductId || quickOrderProductTitle || quickOrderPlatform ? (
        <section className="space-y-3 rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-white/80">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/80">Quick-order context</p>
          {highlightedProduct ? (
            <>
              <p className="text-lg text-white">
                We preselected <span className="font-semibold">{highlightedProduct.title}</span>
                {quickOrderPlatform ? ` for ${quickOrderPlatform}` : ""}. Review the service details below, then configure the blueprint to send your order.
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <Link
                  href={(() => {
                    const params = new URLSearchParams();
                    if (quickOrderPlatform) {
                      params.set("platform", quickOrderPlatform);
                    }
                    if (quickOrderSessionId) {
                      params.set("quickOrderSessionId", quickOrderSessionId);
                    }
                    const query = params.toString();
                    return query.length > 0
                      ? `/products/${highlightedProduct.slug}?${query}`
                      : `/products/${highlightedProduct.slug}`;
                  })()}
                  className="inline-flex items-center justify-center rounded-full border border-white/40 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/90 transition hover:border-white/70 hover:text-white"
                >
                  Open product builder
                </Link>
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center rounded-full border border-transparent px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                >
                  Clear quick-order filter
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-white/70">
              Quick-order parameters referenced “{quickOrderProductTitle ?? quickOrderProductId ?? "unknown"}”, but we
              couldn’t find a matching service. Browse the catalog below or use the filters to refine your search.
            </p>
          )}
        </section>
      ) : null}

      <Filters
        categories={categories}
        query={query ?? ""}
        selectedCategory={searchParams?.category}
        selectedSort={sort}
      />

      <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-white/50">Results</p>
          <p className="text-lg text-white">
            Showing {sortedProducts.length} {sortedProducts.length === 1 ? "service" : "services"}
            {query ? ` matching “${query}”` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/60">
          <span>Sort:</span>
          <span className="rounded-full border border-white/15 px-3 py-1 text-white/80">
            {sortOptions.find((option) => option.value === sort)?.label ?? "Featured"}
          </span>
        </div>
      </section>

      <CatalogInsightsSection insights={catalogInsights} currentQuery={query} />

      {bundleRecommendations.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Bundle recommendations</h2>
              <p className="text-sm text-white/60">
                Pair services that share playbooks to accelerate multi-channel growth.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-white/40">
              {bundleRecommendations.length} options
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {bundleRecommendations.slice(0, 4).map((bundle) => (
              <div
                key={bundle.key}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/70 backdrop-blur transition hover:border-white/20"
              >
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold text-white">{bundle.title}</p>
                  {bundle.savings ? (
                    <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                      {bundle.savings}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2">{bundle.description}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
                  <Link
                    href={`/products/${bundle.primarySlug}`}
                    className="rounded-full border border-white/20 px-3 py-1 transition hover:border-white/40 hover:text-white"
                  >
                    View {bundle.primarySlug.replace("-", " ")}
                  </Link>
                  <Link
                    href={`/products/${bundle.secondarySlug}`}
                    className="rounded-full border border-white/20 px-3 py-1 transition hover:border-white/40 hover:text-white"
                  >
                    View {bundle.secondarySlug.replace("-", " ")}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Suspense fallback={<div className="text-sm text-white/60">Loading catalog…</div>}>
        <ProductGrid
          products={sortedProducts}
          highlightProductId={highlightedProduct?.id ?? null}
          quickOrderSessionId={quickOrderSessionId}
        />
      </Suspense>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h2 className="text-2xl font-semibold">Why choose SMPLAT?</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-blue-300">Real results</h3>
            <p className="mt-2 text-sm text-white/70">
              Authentic growth with engagement from targeted audiences in your niche.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-green-300">Safe &amp; compliant</h3>
            <p className="mt-2 text-sm text-white/70">
              Strategies engineered to respect platform policies and keep your accounts safe.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-purple-300">Dedicated success pod</h3>
            <p className="mt-2 text-sm text-white/70">
              Strategist, analyst, and campaign manager aligned to your brand objectives.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
