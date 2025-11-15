jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom");
  return {
    ...actual,
    useFormState: (_action: unknown, initialState: unknown) => [initialState, undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

jest.mock("../forms", () => ({
  CreatePricingExperimentForm: () => <div data-testid="create-form" />,
  PricingExperimentStatusForm: () => <div data-testid="status-form" />,
  PricingExperimentEventForm: () => <div data-testid="event-form" />,
}));

import { render, screen } from "@testing-library/react";

import PricingExperimentsPage from "../page";

jest.mock("@/server/catalog/pricing-experiments", () => ({
  fetchPricingExperiments: jest.fn(),
}));

const mockFetch = jest.requireMock("@/server/catalog/pricing-experiments")
  .fetchPricingExperiments as jest.Mock;

const baseExperiment = {
  slug: "spring-offer",
  name: "Spring offer",
  description: "Test PDP badge copy against checkout nudges.",
  status: "running",
  targetProductSlug: "instagram-growth",
  targetSegment: "creators",
  featureFlagKey: "pricing_spring_offer",
  assignmentStrategy: "sequential",
  variants: [
    {
      key: "control",
      name: "Control",
      description: "Current pricing.",
      weight: 50,
      isControl: true,
      adjustmentKind: "delta",
      priceDeltaCents: 0,
      priceMultiplier: null,
      metrics: [
        { windowStart: "2025-01-01", exposures: 100, conversions: 12, revenueCents: 42000 },
        { windowStart: "2025-01-02", exposures: 110, conversions: 12, revenueCents: 48000 },
      ],
    },
    {
      key: "variant-a",
      name: "Variant A",
      description: "Offer tiered discount.",
      weight: 50,
      isControl: false,
      adjustmentKind: "delta",
      priceDeltaCents: -1500,
      priceMultiplier: null,
      metrics: [
        { windowStart: "2025-01-01", exposures: 120, conversions: 18, revenueCents: 51000 },
        { windowStart: "2025-01-02", exposures: 140, conversions: 19, revenueCents: 60000 },
      ],
    },
  ],
  provenance: {},
};

describe("PricingExperimentsPage", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("renders experiment table, KPI cards, and cards for each experiment", async () => {
    mockFetch.mockResolvedValue([baseExperiment]);

    const page = await PricingExperimentsPage();
    render(page);

    expect(screen.getByText("Experiment registry")).toBeInTheDocument();
    expect(screen.getByText("Running experiments")).toBeInTheDocument();
    expect(screen.getAllByText("Spring offer").length).toBeGreaterThan(0);
    expect(screen.getByText(/pricing_spring_offer/i)).toBeInTheDocument();
  });
});
