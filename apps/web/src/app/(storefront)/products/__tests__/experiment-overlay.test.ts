import type {
  CatalogBundleRecommendation,
  CatalogExperimentResponse,
  CatalogExperimentVariant,
} from "@smplat/types";
import {
  buildBundleExperimentOverlay,
  filterExperimentsForRecommendations,
  hasGuardrailBreaches,
} from "../experiment-overlay";

describe("experiment overlay", () => {
  const makeVariant = (overrides: Partial<CatalogExperimentVariant> = {}): CatalogExperimentVariant => ({
    key: overrides.key ?? "control",
    name: overrides.name ?? "Control",
    weight: overrides.weight ?? 50,
    isControl: overrides.isControl ?? true,
    bundleSlug: overrides.bundleSlug ?? "bundle-alpha",
    overridePayload: overrides.overridePayload ?? {},
    metrics:
      overrides.metrics ??
      [
        {
          windowStart: new Date("2025-05-09T00:00:00Z"),
          lookbackDays: 30,
          acceptanceRate: 0.2,
          acceptanceCount: 20,
          sampleSize: 100,
          liftVsControl: null,
          guardrailBreached: false,
          computedAt: new Date("2025-05-09T02:00:00Z"),
        },
      ],
  });

  const makeExperiment = (
    overrides: Partial<CatalogExperimentResponse> = {},
  ): CatalogExperimentResponse => ({
    slug: overrides.slug ?? "exp-alpha",
    name: overrides.name ?? "Experiment Alpha",
    description: overrides.description ?? null,
    status: overrides.status ?? "running",
    guardrailConfig: overrides.guardrailConfig ?? {},
    sampleSizeGuardrail: overrides.sampleSizeGuardrail ?? 0,
    variants: overrides.variants ?? [makeVariant()],
    provenance: overrides.provenance ?? {},
  });

  it("indexes experiment variants by bundle slug", () => {
    const experiments = [
      makeExperiment({
        variants: [
          makeVariant({ key: "control", bundleSlug: "bundle-alpha", isControl: true }),
          makeVariant({
            key: "test",
            bundleSlug: "bundle-beta",
            isControl: false,
            metrics: [
              {
                windowStart: new Date("2025-05-09T00:00:00Z"),
                lookbackDays: 30,
                acceptanceRate: 0.12,
                acceptanceCount: 12,
                sampleSize: 120,
                liftVsControl: 0.1,
                guardrailBreached: true,
                computedAt: new Date("2025-05-09T03:00:00Z"),
              },
            ],
          }),
        ],
      }),
    ];

    const overlay = buildBundleExperimentOverlay(experiments);
    const betaVariants = overlay.get("bundle-beta");
    expect(betaVariants).toBeDefined();
    expect(betaVariants?.[0].variantKey).toBe("test");
    expect(betaVariants?.[0].guardrailBreached).toBe(true);
    expect(betaVariants?.[0].latestSampleSize).toBe(120);
  });

  it("filters experiments to those matching recommended bundles", () => {
    const experiments = [
      makeExperiment({ slug: "exp-alpha", variants: [makeVariant({ bundleSlug: "bundle-alpha" })] }),
      makeExperiment({ slug: "exp-beta", variants: [makeVariant({ bundleSlug: "bundle-gamma" })] }),
    ];
    const recommendations: CatalogBundleRecommendation[] = [
      {
        slug: "bundle-alpha",
        title: "Bundle Alpha",
        description: null,
        savingsCopy: null,
        components: [],
        score: 10,
        acceptanceRate: 0.2,
        acceptanceCount: 20,
        queueDepth: 1,
        lookbackDays: 30,
        cmsPriority: 10,
        notes: [],
        provenance: {
          source: "qa",
          cacheLayer: "edge",
          cacheRefreshedAt: new Date(),
          cacheExpiresAt: new Date(),
          cacheTtlMinutes: 10,
          notes: [],
        },
      },
    ];

    const filtered = filterExperimentsForRecommendations(recommendations, experiments);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].slug).toBe("exp-alpha");
  });

  it("detects guardrail breaches from overlay", () => {
    const overlay = buildBundleExperimentOverlay([
      makeExperiment({
        status: "paused",
        variants: [
          makeVariant({
            bundleSlug: "bundle-alpha",
            metrics: [
              {
                windowStart: new Date(),
                lookbackDays: 30,
                acceptanceRate: 0.05,
                acceptanceCount: 5,
                sampleSize: 100,
                liftVsControl: null,
                guardrailBreached: true,
                computedAt: new Date(),
              },
            ],
          }),
        ],
      }),
    ]);

    expect(hasGuardrailBreaches(overlay.get("bundle-alpha"))).toBe(true);
  });
});
