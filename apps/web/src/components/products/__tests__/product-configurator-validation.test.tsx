import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProductConfigurator, type ConfiguratorCustomField } from "../product-configurator";

const createBaseProps = () => ({
  basePrice: 1000,
  currency: "EUR",
  optionGroups: [],
  addOns: [],
  subscriptionPlans: [],
  onChange: jest.fn(),
});

describe("ProductConfigurator field validation", () => {
  it("enforces allowed values", async () => {
    const customFields: ConfiguratorCustomField[] = [
      {
        id: "channel",
        label: "Preferred Channel",
        type: "text",
        validation: { allowedValues: ["instagram", "tiktok"] },
      },
    ];

    render(<ProductConfigurator {...createBaseProps()} customFields={customFields} />);

    const input = screen.getByLabelText("Preferred Channel");
    fireEvent.change(input, { target: { value: "linkedin" } });

    await waitFor(() =>
      expect(
        screen.getByText(/Preferred Channel must match one of: instagram, tiktok/i),
      ).toBeInTheDocument(),
    );

    fireEvent.change(input, { target: { value: "instagram" } });
    await waitFor(() =>
      expect(
        screen.queryByText(/Preferred Channel must match one of/i),
      ).not.toBeInTheDocument(),
    );
  });

  it("enforces numeric step validation", async () => {
    const customFields: ConfiguratorCustomField[] = [
      {
        id: "budget",
        label: "Budget",
        type: "number",
        validation: { numericStep: 5 },
      },
    ];

    render(<ProductConfigurator {...createBaseProps()} customFields={customFields} />);

    const input = screen.getByLabelText("Budget");
    fireEvent.change(input, { target: { value: "12" } });

    await waitFor(() =>
      expect(screen.getByText(/Budget must increase in increments of 5/)).toBeInTheDocument(),
    );

    fireEvent.change(input, { target: { value: "15" } });
    await waitFor(() =>
      expect(screen.queryByText(/Budget must increase in increments/)).not.toBeInTheDocument(),
    );
  });
});
