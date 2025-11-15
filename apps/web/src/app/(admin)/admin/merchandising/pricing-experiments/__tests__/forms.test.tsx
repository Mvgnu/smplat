jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom");
  return {
    ...actual,
    useFormState: (_action: unknown, initialState: unknown) => [initialState, undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

import { fireEvent, render, screen } from "@testing-library/react";

import { CreatePricingExperimentForm, PricingExperimentStatusForm } from "../forms";

jest.mock("../actions", () => ({
  initialActionState: { success: false, error: null },
  createPricingExperimentAction: jest.fn(),
  updatePricingExperimentAction: jest.fn(),
  recordPricingExperimentEventAction: jest.fn(),
}));

const mockExperiment = {
  slug: "spring-offer",
  name: "Spring offer",
  description: "Test PDP badge copy against checkout nudges.",
  status: "draft",
  targetProductSlug: "instagram-growth",
  targetSegment: null,
  featureFlagKey: null,
  assignmentStrategy: "sequential",
  variants: [],
  provenance: {},
};

describe("PricingExperiment forms", () => {
  it("allows adding additional variants when creating a new experiment", () => {
    render(<CreatePricingExperimentForm />);

    expect(screen.getAllByText(/Variant \d+/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /\+ add variant/i }));
    expect(screen.getAllByText(/Variant \d+/i)).toHaveLength(3);
  });

  it("prefills status form with experiment values", () => {
    render(<PricingExperimentStatusForm experiment={mockExperiment} />);
    expect(screen.getByDisplayValue("draft")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sequential")).toBeInTheDocument();
  });
});
