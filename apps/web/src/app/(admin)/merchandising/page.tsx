import {
  AdminBreadcrumbs,
  AdminDataTable,
  type AdminDataTableColumn,
  AdminKpiCard,
  AdminTabNav,
} from "@/components/admin";

import { ADMIN_PRIMARY_TABS } from "../admin-tabs";
import { AssetUploadForm } from "./asset-upload-form";
import { BundleDeleteForm } from "./bundle-delete-form";
import { BundleForm } from "./bundle-form";
import { ProductAuditLog } from "./product-audit-log";
import { ProductChannelForm } from "./product-channel-form";
import { ProductStatusForm } from "./product-status-form";
import { OptionMatrixEditor } from "./option-matrix-editor";
import { fetchCatalogBundles } from "@/server/catalog/bundles";
import { fetchProductDetail, fetchProductSummaries } from "@/server/catalog/products";
import { getOrCreateCsrfToken } from "@/server/security/csrf";

// meta: route: admin/merchandising

type ProductTableRow = {
  id: string;
  title: string;
  status: string;
  channels: string;
  basePrice: string;
  updatedAt: string;
};

const MERCHANDISING_BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Merchandising" },
];

const PRODUCT_COLUMNS: AdminDataTableColumn<ProductTableRow>[] = [
  { key: "title", header: "Product" },
  { key: "channels", header: "Channels" },
  { key: "basePrice", header: "Base price" },
  {
    key: "status",
    header: "Status",
    render: (item) => (
      <span className="inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60">
        {item.status}
      </span>
    ),
  },
  { key: "updatedAt", header: "Last updated" },
];

export default async function AdminMerchandisingPage() {
  const [products, bundles, csrfToken] = await Promise.all([
    fetchProductSummaries(),
    fetchCatalogBundles(),
    Promise.resolve(getOrCreateCsrfToken()),
  ]);

  const productDetails = await Promise.all(products.map((product) => fetchProductDetail(product.slug)));

  const detailById = new Map(
    productDetails
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
      .map((detail) => [detail.id, detail])
  );

  const liveCount = products.filter((product) => product.status === "active").length;
  const draftCount = products.filter((product) => product.status === "draft").length;
  const archivedCount = products.filter((product) => product.status === "archived").length;
  const channelSet = new Set(products.flatMap((product) => product.channelEligibility));

  const productRows: ProductTableRow[] = products.map((product) => ({
    id: product.id,
    title: product.title,
    status: product.status,
    channels: product.channelEligibility.length
      ? product.channelEligibility.map((channel) => channel.toUpperCase()).join(", ")
      : "—",
    basePrice: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: product.currency,
    }).format(product.basePrice),
    updatedAt: new Date(product.updatedAt).toLocaleString(),
  }));

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs
        items={MERCHANDISING_BREADCRUMBS}
        trailingAction={<span className="text-xs uppercase tracking-[0.3em] text-white/40">Workspace synced</span>}
      />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard label="Live products" value={liveCount} footer="Publishing to storefront" />
        <AdminKpiCard label="Drafts" value={draftCount} footer="Awaiting review" />
        <AdminKpiCard label="Archived" value={archivedCount} footer="Hidden from operators" />
        <AdminKpiCard label="Channels" value={channelSet.size} footer={Array.from(channelSet).join(", ") || "Unassigned"} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Catalog overview</h2>
          <p className="text-sm text-white/60">
            Update channel eligibility, review publishing status, and attach assets for each product.
          </p>
        </div>
        <AdminDataTable columns={PRODUCT_COLUMNS} data={productRows} rowKey={(row) => row.id} />
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Product controls</h3>
        <div className="grid gap-6 md:grid-cols-2">
          {products.map((product) => {
            const detail = detailById.get(product.id);
            return (
              <div key={product.id} className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-6">
                <header className="space-y-1">
                  <h4 className="text-base font-semibold text-white">{product.title}</h4>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">{product.slug}</p>
                </header>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ProductChannelForm
                    productId={product.id}
                    activeChannels={product.channelEligibility}
                    csrfToken={csrfToken}
                  />
                  <ProductStatusForm
                    productId={product.id}
                    currentStatus={product.status}
                    csrfToken={csrfToken}
                  />
                </div>
              <AssetUploadForm productId={product.id} csrfToken={csrfToken} />
              {detail ? (
                <OptionMatrixEditor product={detail} csrfToken={csrfToken} />
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
                  Configuration editing is unavailable for this product while offline.
                </p>
              )}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/60">
                <h5 className="text-xs uppercase tracking-[0.3em] text-white/40">Assets</h5>
                {detail?.mediaAssets.length ? (
                  <ul className="mt-2 space-y-1">
                    {detail.mediaAssets.map((asset) => (
                      <li key={asset.id} className="truncate">
                        <a
                          href={asset.assetUrl}
                          className="text-emerald-300 hover:text-emerald-200"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {asset.label ?? asset.assetUrl}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2">No assets uploaded.</p>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h5 className="text-xs uppercase tracking-[0.3em] text-white/40">Audit log</h5>
                <ProductAuditLog entries={detail?.auditLog ?? []} csrfToken={csrfToken} />
              </div>
            </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-white">Catalog bundles</h3>
          <p className="text-sm text-white/60">
            Configure deterministic bundles powering storefront recommendations. Components accept product slugs.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {bundles.length === 0 ? (
              <p className="text-sm text-white/60">No bundles published yet.</p>
            ) : (
              <ul className="space-y-4">
                {bundles.map((bundle) => (
                  <li key={bundle.id} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">{bundle.bundleSlug}</span>
                      <h4 className="text-base font-semibold text-white">{bundle.title}</h4>
                      <p className="text-sm text-white/60">{bundle.description ?? "No description provided."}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
                      {bundle.components.map((component) => (
                        <span key={component.slug} className="rounded-full border border-white/10 px-3 py-1 uppercase tracking-[0.2em]">
                          {component.slug}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-white/40">
                      <span>Priority {bundle.cmsPriority}</span>
                      <BundleDeleteForm bundleId={bundle.id} csrfToken={csrfToken} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <BundleForm
            csrfToken={csrfToken}
            bundle={
              bundles[0]
                ? {
                    id: bundles[0].id,
                    primaryProductSlug: bundles[0].primaryProductSlug,
                    bundleSlug: bundles[0].bundleSlug,
                    title: bundles[0].title,
                    description: bundles[0].description ?? null,
                    savingsCopy: bundles[0].savingsCopy ?? null,
                    cmsPriority: bundles[0].cmsPriority,
                    components: bundles[0].components.map((component) => component.slug),
                  }
                : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}
