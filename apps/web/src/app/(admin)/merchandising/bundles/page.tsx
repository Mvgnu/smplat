"use server";

import { revalidatePath } from "next/cache";

import {
  normalizeCatalogRecommendation,
  type CatalogBundleRecommendation,
  type CatalogRecommendationResponse,
  type CatalogRecommendationResponseApi
} from "@smplat/types";
import {
  createCatalogExperiment,
  fetchCatalogExperiments,
  publishCatalogExperiment,
  updateCatalogExperiment
} from "@/server/catalog/experiments";

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKey = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

async function fetchRecommendations(productSlug: string): Promise<CatalogRecommendationResponse | null> {
  if (!apiKey) {
    return null;
  }

  const response = await fetch(`${apiBase}/api/v1/catalog/recommendations`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify({ product_slug: productSlug, freshness_minutes: 15 })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as CatalogRecommendationResponseApi;
  return normalizeCatalogRecommendation(payload);
}

async function refreshRecommendations(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }
  const productSlug = formData.get("productSlug");
  if (!productSlug || typeof productSlug !== "string") {
    throw new Error("Missing product slug");
  }

  await fetch(`${apiBase}/api/v1/catalog/recommendations/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify({ product_slug: productSlug, freshness_minutes: 10 })
  });

  revalidatePath("/admin/merchandising/bundles");
}

async function updateOverride(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }

  const productSlug = formData.get("productSlug");
  const bundleSlug = formData.get("bundleSlug");
  if (!bundleSlug || typeof bundleSlug !== "string") {
    throw new Error("Missing bundle slug");
  }

  const payload = {
    bundle_slug: bundleSlug,
    title: valueOrNull(formData.get("title")),
    description: valueOrNull(formData.get("description")),
    savings_copy: valueOrNull(formData.get("savings")),
    priority: numberOrNull(formData.get("priority")),
    campaign: valueOrNull(formData.get("campaign")),
    tags: parseTags(valueOrNull(formData.get("tags")))
  } satisfies Record<string, unknown>;

  await fetch(`${apiBase}/api/v1/catalog/recommendations/override`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify(payload)
  });

  if (productSlug && typeof productSlug === "string") {
    revalidatePath("/admin/merchandising/bundles");
  }
}

async function createExperiment(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }

  const slug = valueOrNull(formData.get("experimentSlug"));
  const name = valueOrNull(formData.get("experimentName"));
  const description = valueOrNull(formData.get("experimentDescription"));
  const controlBundle = valueOrNull(formData.get("controlBundle"));
  if (!slug || !name || !controlBundle) {
    throw new Error("Missing experiment slug, name, or control bundle");
  }

  const testBundle = valueOrNull(formData.get("testBundle"));
  const guardrailRaw = numberOrNull(formData.get("sampleSizeGuardrail"));
  const minAcceptance = numberOrNull(formData.get("minAcceptance"));

  const guardrailConfig: Record<string, unknown> = {};
  if (minAcceptance !== null) {
    guardrailConfig.min_acceptance_rate = Math.max(0, Number(minAcceptance));
  }

  const variants = [
    {
      key: "control",
      name: "Control",
      weight: 50,
      isControl: true,
      bundleSlug: controlBundle,
      overridePayload: {},
    },
  ];

  if (testBundle) {
    variants.push({
      key: "test",
      name: "Test",
      weight: 50,
      isControl: false,
      bundleSlug: testBundle,
      overridePayload: {},
    });
  }

  await createCatalogExperiment({
    slug,
    name,
    description,
    guardrailConfig,
    sampleSizeGuardrail: guardrailRaw !== null ? Math.max(0, Math.floor(guardrailRaw)) : 0,
    variants,
  });

  revalidatePath("/admin/merchandising/bundles");
}

async function publishExperiment(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }

  const slug = valueOrNull(formData.get("experimentSlug"));
  if (!slug) {
    throw new Error("Missing experiment slug");
  }

  await publishCatalogExperiment(slug);
  revalidatePath("/admin/merchandising/bundles");
}

async function pauseExperiment(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }

  const slug = valueOrNull(formData.get("experimentSlug"));
  if (!slug) {
    throw new Error("Missing experiment slug");
  }

  await updateCatalogExperiment(slug, { status: "paused" });
  revalidatePath("/admin/merchandising/bundles");
}

async function resumeExperiment(formData: FormData) {
  "use server";
  if (!apiKey) {
    return;
  }

  const slug = valueOrNull(formData.get("experimentSlug"));
  if (!slug) {
    throw new Error("Missing experiment slug");
  }

  await updateCatalogExperiment(slug, { status: "running" });
  revalidatePath("/admin/merchandising/bundles");
}

function valueOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTags(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatBundleNotes(bundle: CatalogBundleRecommendation): string {
  const notes = new Set<string>();
  bundle.notes.forEach((note) => notes.add(note));
  bundle.provenance.notes.forEach((note) => notes.add(note));
  return Array.from(notes).join(", ");
}

function formatAcceptanceRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLift(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function resolveMinAcceptance(config: Record<string, unknown> | undefined): number | null {
  if (!config) {
    return null;
  }
  const candidate = (config as Record<string, unknown>)["min_acceptance_rate"];
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export default async function MerchandisingBundlesPage({
  searchParams
}: {
  searchParams: { product?: string };
}) {
  const selectedSlug = typeof searchParams.product === "string" ? searchParams.product : "";
  const recommendations = selectedSlug ? await fetchRecommendations(selectedSlug) : null;
  const experiments = await fetchCatalogExperiments();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
      <header>
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Merchandising</p>
        <h1 className="mt-2 text-3xl font-semibold">Bundle experimentation control</h1>
        <p className="mt-3 text-white/70">
          Inspect deterministic bundle payloads, apply CMS overrides, and refresh caches before shipping campaigns.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h2 className="text-xl font-semibold">Lookup bundles</h2>
        <form className="mt-6 flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm text-white/80">
            Product slug
            <input
              name="product"
              defaultValue={selectedSlug}
              className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
              placeholder="instagram-growth"
            />
          </label>
          <button type="submit" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80">
            Load bundles
          </button>
        </form>
        {!apiKey ? (
          <p className="mt-4 text-sm text-amber-300/80">
            Configure CHECKOUT_API_KEY to access catalog experimentation endpoints.
          </p>
        ) : null}
      </section>

      {selectedSlug && recommendations ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Active bundles for {selectedSlug}</h2>
              <p className="text-white/60">
                Last computed {recommendations.resolvedAt.toLocaleString()} ({recommendations.cacheLayer} cache layer).
              </p>
            </div>
            <form action={refreshRecommendations} className="flex items-center gap-2">
              <input type="hidden" name="productSlug" value={selectedSlug} />
              <button type="submit" className="rounded-full border border-emerald-400/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300/60">
                Refresh cache
              </button>
            </form>
          </div>
          <div className="space-y-4">
            {recommendations.recommendations.length === 0 ? (
              <p className="text-white/60">No bundles configured for this product.</p>
            ) : (
              recommendations.recommendations.map((bundle) => (
                <article key={bundle.slug} className="rounded-3xl border border-white/10 bg-black/30 p-6">
                  <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{bundle.title}</h3>
                      <p className="text-sm text-white/60">Slug: {bundle.slug}</p>
                    </div>
                    <div className="text-right text-xs uppercase tracking-wide text-white/50">
                      Score {bundle.score.toFixed(1)} · Priority {bundle.cmsPriority}
                    </div>
                  </header>
                  {bundle.description ? <p className="mt-3 text-sm text-white/70">{bundle.description}</p> : null}
                  <dl className="mt-4 grid gap-4 text-xs text-white/60 md:grid-cols-4">
                    <div>
                      <dt className="uppercase tracking-wide">Acceptance</dt>
                      <dd className="text-white">{bundle.acceptanceRate !== null ? bundle.acceptanceRate.toFixed(2) : "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide">Queue depth</dt>
                      <dd className="text-white">{bundle.queueDepth}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide">CMS signals</dt>
                      <dd className="text-white/80">{formatBundleNotes(bundle) || "No signals"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide">Components</dt>
                      <dd className="text-white/80">{bundle.components.join(", ")}</dd>
                    </div>
                  </dl>
                  <form action={updateOverride} className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/80 md:grid-cols-2">
                    <input type="hidden" name="productSlug" value={selectedSlug} />
                    <input type="hidden" name="bundleSlug" value={bundle.slug} />
                    <label className="flex flex-col gap-1">
                      Title override
                      <input name="title" defaultValue={bundle.title} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" />
                    </label>
                    <label className="flex flex-col gap-1">
                      Savings copy
                      <input name="savings" defaultValue={bundle.savingsCopy ?? undefined} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" />
                    </label>
                    <label className="md:col-span-2 flex flex-col gap-1">
                      Description override
                      <textarea name="description" rows={2} defaultValue={bundle.description ?? undefined} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" />
                    </label>
                    <label className="flex flex-col gap-1">
                      Priority
                      <input name="priority" type="number" defaultValue={bundle.cmsPriority} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" />
                    </label>
                    <label className="flex flex-col gap-1">
                      Campaign code
                      <input name="campaign" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="Q2-experiment" />
                    </label>
                    <label className="md:col-span-2 flex flex-col gap-1">
                      Tags (comma separated)
                      <input name="tags" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="priority-test, hero-slot" />
                    </label>
                    <div className="md:col-span-2 flex justify-end gap-2">
                      <button type="submit" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80">
                        Apply override
                      </button>
                    </div>
                  </form>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Experimentation control center</h2>
            <p className="text-sm text-white/60">
              Configure bundle experiments, monitor guardrails, and publish overrides when metrics are healthy.
            </p>
          </div>
        </div>

        {apiKey ? (
          <form action={createExperiment} className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/80 md:grid-cols-3">
            <label className="flex flex-col gap-1">
              Experiment slug
              <input name="experimentSlug" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="spring-hero" />
            </label>
            <label className="flex flex-col gap-1">
              Experiment name
              <input name="experimentName" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="Spring hero bundles" />
            </label>
            <label className="flex flex-col gap-1 md:col-span-3">
              Description
              <input name="experimentDescription" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="Homepage hero merch test" />
            </label>
            <label className="flex flex-col gap-1">
              Control bundle slug
              <input name="controlBundle" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="bundle-alpha" />
            </label>
            <label className="flex flex-col gap-1">
              Test bundle slug
              <input name="testBundle" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="bundle-beta" />
            </label>
            <label className="flex flex-col gap-1">
              Sample size guardrail
              <input name="sampleSizeGuardrail" type="number" min={0} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="250" />
            </label>
            <label className="flex flex-col gap-1">
              Min acceptance (0-1)
              <input name="minAcceptance" type="number" step="0.01" min={0} max={1} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="0.35" />
            </label>
            <div className="md:col-span-3 flex justify-end">
              <button type="submit" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80">
                Create experiment
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-6 text-sm text-amber-300/80">Configure CHECKOUT_API_KEY to manage experiments.</p>
        )}

        <div className="mt-8 space-y-4">
          {experiments.length === 0 ? (
            <p className="text-sm text-white/60">No experiments configured yet.</p>
          ) : (
            experiments.map((experiment) => {
              const minAcceptance = resolveMinAcceptance(experiment.guardrailConfig);
              const guardrailTriggered = experiment.variants.some((variant) => variant.metrics[0]?.guardrailBreached);
              return (
                <article
                  key={experiment.slug}
                  className={`rounded-3xl border ${guardrailTriggered ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/30"} p-6`}
                >
                  <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-white">{experiment.name}</h3>
                      <p className="text-sm text-white/60">Slug: {experiment.slug} · Status: {experiment.status}</p>
                      <p className="text-xs text-white/50">
                        Sample guardrail {experiment.sampleSizeGuardrail || 0}
                        {typeof minAcceptance === "number" ? ` · Min acceptance ${formatAcceptanceRate(minAcceptance)}` : null}
                        {guardrailTriggered ? " · Guardrail triggered" : null}
                      </p>
                    </div>
                    {apiKey ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={publishExperiment}>
                          <input type="hidden" name="experimentSlug" value={experiment.slug} />
                          <button className="rounded-full border border-emerald-300/60 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:border-emerald-200">
                            Publish overrides
                          </button>
                        </form>
                        {experiment.status === "running" ? (
                          <form action={pauseExperiment}>
                            <input type="hidden" name="experimentSlug" value={experiment.slug} />
                            <button className="rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:border-amber-200">
                              Pause
                            </button>
                          </form>
                        ) : (
                          <form action={resumeExperiment}>
                            <input type="hidden" name="experimentSlug" value={experiment.slug} />
                            <button className="rounded-full border border-sky-300/60 px-3 py-1 text-xs font-semibold text-sky-200 transition hover:border-sky-200">
                              Resume
                            </button>
                          </form>
                        )}
                      </div>
                    ) : null}
                  </header>
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {experiment.variants.map((variant) => {
                      const metric = variant.metrics[0] ?? null;
                      const guardrailBreached = metric?.guardrailBreached ?? false;
                      return (
                        <div key={variant.key} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <h4 className="text-sm font-semibold text-white">{variant.name}</h4>
                              <p className="text-xs text-white/60">Bundle: {variant.bundleSlug ?? "Unassigned"}</p>
                            </div>
                            <div className="flex gap-2">
                              {variant.isControl ? (
                                <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">Control</span>
                              ) : null}
                              {guardrailBreached ? (
                                <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                  Guardrail tripped
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <dl className="mt-4 grid gap-3 text-xs text-white/70 sm:grid-cols-2">
                            <div>
                              <dt className="uppercase tracking-wide">Acceptance</dt>
                              <dd className="text-white">{metric ? formatAcceptanceRate(metric.acceptanceRate) : "N/A"}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide">Sample size</dt>
                              <dd className="text-white">{metric ? metric.sampleSize : "0"}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide">Conversions</dt>
                              <dd className="text-white">{metric ? metric.acceptanceCount : "0"}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide">Lift vs control</dt>
                              <dd className="text-white">{metric ? formatLift(metric.liftVsControl) : "N/A"}</dd>
                            </div>
                            <div className="sm:col-span-2">
                              <dt className="uppercase tracking-wide">Last computed</dt>
                              <dd className="text-white">{metric ? metric.computedAt.toLocaleString() : "Awaiting telemetry"}</dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
