describe("pricing experiment helpers", () => {
  const originalFlags = process.env.NEXT_PUBLIC_FEATURE_FLAGS;

  afterEach(() => {
    process.env.NEXT_PUBLIC_FEATURE_FLAGS = originalFlags;
    jest.resetModules();
  });

  it("filters experiments by status and feature flag", () => {
    process.env.NEXT_PUBLIC_FEATURE_FLAGS = "pricing_trial";

    jest.isolateModules(() => {
      const {
        filterEnabledPricingExperiments,
        selectExperimentsForProduct,
      } = require("../pricing-experiments") as typeof import("../pricing-experiments");

      const experiments = [
        {
          slug: "flagged-trial",
          name: "Flagged",
          description: null,
          status: "running",
          targetProductSlug: "custom-service",
          targetSegment: null,
          featureFlagKey: "pricing_trial",
          assignmentStrategy: "sequential",
          variants: [],
          provenance: {},
        },
        {
          slug: "inactive",
          name: "Inactive",
          description: null,
          status: "completed",
          targetProductSlug: "custom-service",
          targetSegment: null,
          featureFlagKey: null,
          assignmentStrategy: "sequential",
          variants: [],
          provenance: {},
        },
        {
          slug: "flag-disabled",
          name: "Disabled",
          description: null,
          status: "running",
          targetProductSlug: "custom-service",
          targetSegment: null,
          featureFlagKey: "beta_only",
          assignmentStrategy: "sequential",
          variants: [],
          provenance: {},
        },
      ];

      const enabled = filterEnabledPricingExperiments(experiments as any);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].slug).toBe("flagged-trial");

      const forProduct = selectExperimentsForProduct(enabled as any, "custom-service");
      expect(forProduct).toHaveLength(1);
      expect(forProduct[0].slug).toBe("flagged-trial");
    });
  });

  it("selects variants with heuristics favoring non-control unless strategy prefers control", () => {
    jest.isolateModules(() => {
      const { selectPricingExperimentVariant } =
        require("../pricing-experiments") as typeof import("../pricing-experiments");

      const experiment = {
        slug: "spring",
        name: "Spring",
        description: null,
        status: "running",
        targetProductSlug: "custom-service",
        targetSegment: null,
        featureFlagKey: null,
        assignmentStrategy: "sequential",
        variants: [
          {
            key: "control",
            name: "Control",
            description: null,
            weight: 50,
            isControl: true,
            adjustmentKind: "delta",
            priceDeltaCents: 0,
            priceMultiplier: null,
            metrics: [],
          },
          {
            key: "variant-a",
            name: "Variant A",
            description: null,
            weight: 50,
            isControl: false,
            adjustmentKind: "delta",
            priceDeltaCents: -1500,
            priceMultiplier: null,
            metrics: [],
          },
        ],
        provenance: {},
      };

      const preferredVariant = selectPricingExperimentVariant(experiment as any);
      expect(preferredVariant?.key).toBe("variant-a");

      const controlStrategy = {
        ...experiment,
        assignmentStrategy: "control-first",
        variants: [
          {
            key: "control",
            name: "Control",
            description: null,
            weight: 100,
            isControl: true,
            adjustmentKind: "delta",
            priceDeltaCents: 0,
            priceMultiplier: null,
            metrics: [],
          },
        ],
      };

      const controlVariant = selectPricingExperimentVariant(controlStrategy as any);
      expect(controlVariant?.key).toBe("control");
    });
  });
});
