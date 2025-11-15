export type FieldVisibilityConditionDraft =
  | {
      key: string;
      kind: "option";
      groupKey: string;
      optionKey: string;
    }
  | {
      key: string;
      kind: "addOn";
      addOnKey: string;
    }
  | {
      key: string;
      kind: "subscriptionPlan";
      planKey: string;
    }
  | {
      key: string;
      kind: "channel";
      channel: string;
    };

export type FieldVisibilityConditionUpdate = Partial<Omit<FieldVisibilityConditionDraft, "key" | "kind">>;

export type CustomFieldVisibilityDraft = {
  mode: "all" | "any";
  conditions: FieldVisibilityConditionDraft[];
};

export type RegexTesterDraft = {
  sampleValue: string;
  lastResult: boolean | null;
};

export type CustomFieldDraft = {
  key: string;
  id?: string | null;
  label: string;
  fieldType: "text" | "url" | "number";
  placeholder: string;
  helpText: string;
  required: boolean;
  validation: {
    minLength: string;
    maxLength: string;
    pattern: string;
    regexFlags: string;
    regexDescription: string;
    disallowWhitespace: boolean;
    minValue: string;
    maxValue: string;
    numericStep: string;
    allowedValues: string;
  };
  sampleValues: string;
  defaultValue: string;
  exposeInCheckout: boolean;
  exposeInFulfillment: boolean;
  visibility: CustomFieldVisibilityDraft;
  regexTester: RegexTesterDraft;
};

export type JourneyComponentBindingDraft =
  | {
      key: string;
      kind: "static";
      inputKey: string;
      value: string;
    }
  | {
      key: string;
      kind: "product_field";
      inputKey: string;
      path: string;
      required: boolean;
    }
  | {
      key: string;
      kind: "runtime";
      inputKey: string;
      source: string;
      required: boolean;
    };

export type JourneyComponentDraft = {
  key: string;
  id?: string | null;
  componentId: string;
  displayOrder: string;
  channelEligibility: string;
  isRequired: boolean;
  bindings: JourneyComponentBindingDraft[];
  metadataJson: string;
};
