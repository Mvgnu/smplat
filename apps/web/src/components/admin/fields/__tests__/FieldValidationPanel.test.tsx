import { fireEvent, render, screen } from "@testing-library/react";

import type { CustomFieldDraft } from "@/app/(admin)/admin/products/types";
import { FieldValidationPanel } from "../FieldValidationPanel";

const makeDraft = (overrides: Partial<CustomFieldDraft> = {}): CustomFieldDraft => ({
  key: "field-1",
  id: null,
  label: "Sample field",
  fieldType: "text",
  placeholder: "",
  helpText: "",
  required: false,
  validation: {
    minLength: "",
    maxLength: "",
    pattern: "",
    regexFlags: "",
    regexDescription: "",
    disallowWhitespace: false,
    minValue: "",
    maxValue: "",
    numericStep: "",
    allowedValues: "",
    ...overrides.validation,
  },
  sampleValues: overrides.sampleValues ?? "",
  defaultValue: "",
  exposeInCheckout: true,
  exposeInFulfillment: true,
  visibility: overrides.visibility ?? { mode: "all", conditions: [] },
  regexTester: overrides.regexTester ?? { sampleValue: "", lastResult: null },
});

describe("FieldValidationPanel", () => {
  it("updates validation values", () => {
    const handleValidationChange = jest.fn();
    render(
      <FieldValidationPanel
        field={makeDraft()}
        onValidationChange={handleValidationChange}
        onSampleValuesChange={jest.fn()}
        onRegexTesterChange={jest.fn()}
      />,
    );

    const minLengthInput = screen.getByLabelText("Min length");
    fireEvent.change(minLengthInput, { target: { value: "4" } });
    expect(handleValidationChange).toHaveBeenCalledWith({ minLength: "4" });

    const allowedValuesInput = screen.getByLabelText("Allowed values (comma or newline separated)");
    fireEvent.change(allowedValuesInput, { target: { value: "hero,social" } });
    expect(handleValidationChange).toHaveBeenCalledWith({ allowedValues: "hero,social" });
  });

  it("runs regex tester and surfaces result", () => {
    const handleRegexTesterChange = jest.fn();
    const field = makeDraft({
      validation: { pattern: "^https://", regexFlags: "i", regexDescription: "" },
      regexTester: { sampleValue: "https://brand.example", lastResult: null },
    });

    render(
      <FieldValidationPanel
        field={field}
        onValidationChange={jest.fn()}
        onSampleValuesChange={jest.fn()}
        onRegexTesterChange={handleRegexTesterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /test pattern/i }));
    expect(handleRegexTesterChange).toHaveBeenCalledWith({ lastResult: true });
    expect(screen.getByText(/Sample matches the pattern/)).toBeInTheDocument();
  });

  it("updates sample values textarea", () => {
    const handleSampleValuesChange = jest.fn();
    render(
      <FieldValidationPanel
        field={makeDraft()}
        onValidationChange={jest.fn()}
        onSampleValuesChange={handleSampleValuesChange}
        onRegexTesterChange={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Sample values/i), {
      target: { value: "@brand\n@another" },
    });
    expect(handleSampleValuesChange).toHaveBeenCalledWith("@brand\n@another");
  });
});
