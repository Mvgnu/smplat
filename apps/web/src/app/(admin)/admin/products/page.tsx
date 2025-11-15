"use server";

import Link from "next/link";

import { AdminBreadcrumbs, AdminTabNav } from "@/components/admin";
import { ADMIN_PRIMARY_TABS, ADMIN_SECTIONS } from "../../admin-tabs";
import { ProductsClient, type ProductDetailRecord, type ProductRecord } from "./ProductsClient";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import type { ProductJourneyRuntime } from "@smplat/types";

// Use the ProductRecord type from ProductsClient

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const PRODUCTS_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Product catalog" }
];

const merchandiseSection = ADMIN_SECTIONS.find((section) => section.href === "/admin/merchandising");

async function fetchProducts(): Promise<ProductRecord[]> {
  const response = await fetch(`${apiBase}/api/v1/products/`, { cache: "no-store" });
  if (!response.ok) {
    return [];
  }
  return response.json();
}

async function fetchProductDetail(slug: string): Promise<ProductDetailRecord | null> {
  const response = await fetch(`${apiBase}/api/v1/products/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  const ensureArray = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);
  const rawChannels =
    payload.channelEligibility ??
    payload.channel_eligibility ??
    [];
  return {
    ...payload,
    channelEligibility: Array.isArray(rawChannels) ? rawChannels : [],
    optionGroups: ensureArray(payload.optionGroups ?? payload.option_groups),
    addOns: ensureArray(payload.addOns ?? payload.add_ons),
    customFields: ensureArray(payload.customFields ?? payload.custom_fields),
    subscriptionPlans: ensureArray(payload.subscriptionPlans ?? payload.subscription_plans),
    configurationPresets: ensureArray(payload.configurationPresets ?? payload.configuration_presets),
    journeyComponents: ensureArray(payload.journeyComponents ?? payload.journey_components),
  } as ProductDetailRecord;
}

async function fetchProductJourneyRuntime(productId: string): Promise<ProductJourneyRuntime | null> {
  const response = await fetch(`${apiBase}/api/v1/products/${productId}/journeys`, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

// Mutations are handled client-side in ProductsClient

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawSlug = searchParams?.productSlug;
  const productSlug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const [products, csrfToken] = await Promise.all([fetchProducts(), Promise.resolve(getOrCreateCsrfToken())]);
  let initialProduct: ProductDetailRecord | null = null;
  let initialJourneyRuntime: ProductJourneyRuntime | null = null;
  if (productSlug) {
    initialProduct = await fetchProductDetail(productSlug);
    if (initialProduct?.id) {
      initialJourneyRuntime = await fetchProductJourneyRuntime(initialProduct.id);
    }
  }

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={PRODUCTS_BREADCRUMBS}
        trailingAction={
          merchandiseSection ? (
            <Link
              href={merchandiseSection.href}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
            >
              View merchandising workspace
            </Link>
          ) : undefined
        }
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <ProductsClient
        products={products}
        apiBase={apiBase}
        csrfToken={csrfToken}
        initialProduct={initialProduct}
        initialJourneyRuntime={initialJourneyRuntime}
      />
    </div>
  );
}
