import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminDataTable,
  type AdminDataTableColumn,
  AdminKpiCard,
  AdminTabNav,
} from "@/components/admin";
import { ADMIN_PRIMARY_TABS } from "../../../admin-tabs";
import { fetchPricingExperiments } from "@/server/catalog/pricing-experiments";
import { CreatePricingExperimentForm } from "./forms";
import { PricingExperimentCard } from "./experiment-card";

export const metadata: Metadata = {
  title: "Pricing experiments",
};

const BREADCRUMBS = [
  { label: "Control hub", href: "/admin/orders" },
  { label: "Merchandising", href: "/admin/merchandising" },
  { label: "Pricing experiments" },
];

type ExperimentRow = {
  slug: string;
  name: string;
  status: string;
  targetProduct: string;
  variants: number;
  lastWindow: string;
};

const TABLE_COLUMNS: AdminDataTableColumn<ExperimentRow>[] = [
  { key: "name", header: "Experiment" },
  { key: "targetProduct", header: "Target product" },
  { key: "status", header: "Status" },
  { key: "variants", header: "Variants", align: "center" },
  { key: "lastWindow", header: "Last telemetry window", align: "right" },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const computeLastWindow = (isoDate: string | null): string => {
  if (!isoDate) {
    return "No data";
  }
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return dateFormatter.format(parsed);
};

export default async function PricingExperimentsPage() {
  const experiments = await fetchPricingExperiments();

  const runningCount = experiments.filter((experiment) => experiment.status === "running").length;
  const pausedCount = experiments.filter((experiment) => experiment.status === "paused").length;
  const completedCount = experiments.filter((experiment) => experiment.status === "completed").length;
  const totalVariants = experiments.reduce((sum, experiment) => sum + experiment.variants.length, 0);

  const tableRows: ExperimentRow[] = experiments.map((experiment) => {
    const lastWindow = experiment.variants
      .flatMap((variant) => variant.metrics)
      .sort((a, b) => {
        if (!a.windowStart) {
          return 1;
        }
        if (!b.windowStart) {
          return -1;
        }
        return a.windowStart.localeCompare(b.windowStart);
      })
      .at(-1)?.windowStart;

    return {
      slug: experiment.slug,
      name: experiment.name,
      status: experiment.status,
      targetProduct: experiment.targetProductSlug,
      variants: experiment.variants.length,
      lastWindow: computeLastWindow(lastWindow ?? null),
    };
  });

  return (
    <div className="space-y-8">
      <AdminBreadcrumbs items={BREADCRUMBS} />
      <AdminTabNav tabs={ADMIN_PRIMARY_TABS} />

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard label="Running experiments" value={runningCount} />
        <AdminKpiCard label="Paused" value={pausedCount} />
        <AdminKpiCard label="Completed" value={completedCount} />
        <AdminKpiCard
          label="Total variants"
          value={totalVariants}
          footer="Sum of control + challenger variants"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Catalog</p>
            <h2 className="text-2xl font-semibold text-white">Experiment registry</h2>
          </div>
          <p className="text-sm text-white/60">
            Track every experiment touching storefront pricing before rolling changes to customers.
          </p>
        </div>
        <AdminDataTable
          columns={TABLE_COLUMNS}
          data={tableRows}
          rowKey={(row) => row.slug}
          emptyState="No pricing experiments configured yet."
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          {experiments.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/20 bg-black/40 p-12 text-center text-sm text-white/60">
              Create your first pricing experiment to start modeling PDP and checkout price deltas.
            </div>
          ) : (
            experiments.map((experiment) => (
              <PricingExperimentCard key={experiment.slug} experiment={experiment} />
            ))
          )}
        </div>
        <div className="space-y-6">
          <CreatePricingExperimentForm />
        </div>
      </section>
    </div>
  );
}
