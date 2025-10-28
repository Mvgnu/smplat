// meta: route: storefront/trust-preview
// meta: feature: checkout-trust-preview

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { CheckoutMetricVerification, CheckoutTrustExperience } from "@/server/cms/trust";
import { getCheckoutTrustExperience, getCheckoutTrustExperienceDraft } from "@/server/cms/trust";

export const metadata: Metadata = {
  title: "Trust preview | SMPLAT",
  description: "Operator preview for checkout trust modules and live metric overlays.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: { id: string };
  searchParams?: { token?: string };
};

function formatMetricState(metric?: CheckoutMetricVerification): string {
  if (!metric) {
    return "unbound";
  }
  if (metric.verificationState === "preview" && metric.previewState) {
    return `preview • ${metric.previewState}`;
  }
  return metric.verificationState;
}

function formatComputedAt(metric?: CheckoutMetricVerification): string | null {
  if (!metric?.computedAt) {
    return null;
  }
  const parsed = new Date(metric.computedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString("en-US", { timeZone: "UTC" });
}

function MetricDetails({ metric }: { metric?: CheckoutMetricVerification }) {
  if (!metric) {
    return <p className="text-xs text-white/50">No metric binding configured.</p>;
  }

  return (
    <div className="space-y-1 text-xs text-white/60">
      <p>
        <span className="font-medium text-white/70">Metric:</span> {metric.metricId}
      </p>
      <p>
        <span className="font-medium text-white/70">State:</span> {formatMetricState(metric)}
      </p>
      {metric.formattedValue ? (
        <p>
          <span className="font-medium text-white/70">Value:</span> {metric.formattedValue}
        </p>
      ) : null}
      {typeof metric.rawValue === "number" ? (
        <p>
          <span className="font-medium text-white/70">Raw:</span> {metric.rawValue}
        </p>
      ) : null}
      {metric.sampleSize ? (
        <p>
          <span className="font-medium text-white/70">Sample size:</span> {metric.sampleSize}
        </p>
      ) : null}
      {metric.source ? (
        <p>
          <span className="font-medium text-white/70">Source:</span> {metric.source}
        </p>
      ) : null}
      {formatComputedAt(metric) ? (
        <p>
          <span className="font-medium text-white/70">Computed:</span> {formatComputedAt(metric)}
        </p>
      ) : null}
      {metric.provenanceNote ? (
        <p>
          <span className="font-medium text-white/70">Provenance:</span> {metric.provenanceNote}
        </p>
      ) : null}
    </div>
  );
}

function AssurancesPreview({ experience }: { experience: CheckoutTrustExperience }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-white">Assurances</h3>
      <ul className="space-y-3">
        {experience.assurances.map((assurance) => (
          <li key={assurance.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{assurance.title}</p>
                <p className="text-sm text-white/60">{assurance.description}</p>
              </div>
              <span className="text-xs text-white/50">{formatMetricState(assurance.metric)}</span>
            </div>
            {assurance.evidence ? (
              <p className="mt-2 text-xs text-white/50">Evidence: {assurance.evidence}</p>
            ) : null}
            <MetricDetails metric={assurance.metric} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SnapshotsPreview({ experience }: { experience: CheckoutTrustExperience }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-white">Performance snapshots</h3>
      <ul className="space-y-3">
        {experience.performanceSnapshots.map((snapshot) => (
          <li key={snapshot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{snapshot.label}</p>
                <p className="text-sm text-white/60">{snapshot.value}</p>
              </div>
              <span className="text-xs text-white/50">{formatMetricState(snapshot.metric)}</span>
            </div>
            {snapshot.caption ? (
              <p className="mt-2 text-xs text-white/50">{snapshot.caption}</p>
            ) : null}
            <MetricDetails metric={snapshot.metric} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function TrustPreviewPage({ params, searchParams }: PageProps) {
  const slug = params.id || "checkout";
  const previewToken = process.env.CHECKOUT_PREVIEW_TOKEN ?? "";
  if (previewToken && searchParams?.token !== previewToken) {
    notFound();
  }

  const [draftExperience, liveExperience] = await Promise.all([
    getCheckoutTrustExperienceDraft(slug),
    getCheckoutTrustExperience(),
  ]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 text-white">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Trust module preview</h1>
          <p className="text-sm text-white/60">
            Compare the CMS draft copy for <span className="font-semibold text-white">{slug}</span> with live
            metric overlays powering checkout trust.
          </p>
        </div>
        <Link
          href="/checkout"
          className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:border-white/60"
        >
          Open checkout
        </Link>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="space-y-6 rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">CMS draft content</h2>
            <p className="text-sm text-white/60">
              Draft copy from Payload with preview-state annotations for each metric binding.
            </p>
          </div>
          <AssurancesPreview experience={draftExperience} />
          <SnapshotsPreview experience={draftExperience} />
        </article>

        <article className="space-y-6 rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6 backdrop-blur">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-emerald-100">Live metric overlay</h2>
            <p className="text-sm text-emerald-100/80">
              Fulfillment-backed readings consumed by checkout. Values update automatically when metrics refresh.
            </p>
          </div>
          <AssurancesPreview experience={liveExperience} />
          <SnapshotsPreview experience={liveExperience} />
        </article>
      </section>
    </main>
  );
}
