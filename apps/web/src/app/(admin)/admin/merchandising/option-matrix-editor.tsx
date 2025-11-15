"use client";

// meta: component: admin-option-matrix-editor

import { useCallback, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { FieldValidationPanel } from "@/components/admin/fields/FieldValidationPanel";
import {
  ProductConfigurator,
  type ConfiguratorAddOn,
  type ConfiguratorCustomField,
  type ConfiguratorOptionGroup,
  type ConfiguratorPreset,
  type ConfiguratorSelection,
  type SubscriptionPlan as ConfiguratorSubscriptionPlan,
} from "@/components/products/product-configurator";
import {
  normalizeCustomFieldMetadata as sharedNormalizeCustomFieldMetadata,
  serializeCustomFieldMetadata as sharedSerializeCustomFieldMetadata,
} from "@/lib/product-metadata";
import type { ProductCustomFieldMetadata } from "@/types/product";
import type { CustomFieldDraft, CustomFieldVisibilityDraft } from "@/app/(admin)/admin/products/types";
import { initialActionState, updateProductConfigurationAction } from "./actions";
import type { ProductDetail } from "@/server/catalog/products";

function generateKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

type OptionDraft = {
  key: string;
  id: string | null;
  name: string;
  description: string;
  priceDelta: number;
  displayOrder: number;
  recommended: boolean;
  metadata: Record<string, unknown>;
};

type GroupDraft = {
  key: string;
  id: string | null;
  name: string;
  description: string;
  groupType: "single" | "multiple";
  isRequired: boolean;
  displayOrder: number;
  options: OptionDraft[];
  metadata: Record<string, unknown>;
};

type AddOnDraft = {
  key: string;
  id: string | null;
  label: string;
  description: string;
  priceDelta: number;
  isRecommended: boolean;
  displayOrder: number;
};

type MerchCustomFieldDraft = CustomFieldDraft & {
  id: string | null;
  displayOrder: number;
};

type PlanDraft = {
  key: string;
  id: string | null;
  label: string;
  description: string;
  billingCycle: "one_time" | "monthly" | "quarterly" | "annual";
  priceMultiplier: number | null;
  priceDelta: number | null;
  isDefault: boolean;
  displayOrder: number;
};

type PresetSelectionDraft = {
  optionSelections: Record<string, string[]>;
  addOnIds: string[];
  subscriptionPlanId: string | null;
  customFieldValues: Record<string, string>;
};

type ConfigurationPresetDraft = {
  key: string;
  id: string | null;
  label: string;
  summary: string;
  heroImageUrl: string;
  badge: string;
  priceHint: string;
  displayOrder: number;
  selection: PresetSelectionDraft;
};

const emptyValidationState: CustomFieldDraft["validation"] = {
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
};

const emptyRegexTesterState: CustomFieldDraft["regexTester"] = {
  sampleValue: "",
  lastResult: null,
};

const emptyVisibilityState: CustomFieldVisibilityDraft = {
  mode: "all",
  conditions: [],
};

function parseDelimitedList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function extractVisibilityDraft(metadata: ProductCustomFieldMetadata | undefined): CustomFieldVisibilityDraft {
  const descriptor = metadata?.conditionalVisibility ?? metadata?.visibilityRules;
  if (!descriptor || !Array.isArray(descriptor.conditions) || descriptor.conditions.length === 0) {
    return { ...emptyVisibilityState, conditions: [] };
  }

  return {
    mode: descriptor.mode === "any" ? "any" : "all",
    conditions: descriptor.conditions.map((condition) => {
      if (condition.kind === "option") {
        return {
          key: generateKey("field-visibility"),
          kind: "option",
          groupKey: condition.groupId ?? condition.groupKey ?? "",
          optionKey: condition.optionId ?? condition.optionKey ?? "",
        };
      }
      if (condition.kind === "addOn") {
        return {
          key: generateKey("field-visibility"),
          kind: "addOn",
          addOnKey: condition.addOnId ?? condition.addOnKey ?? "",
        };
      }
      if (condition.kind === "subscriptionPlan") {
        return {
          key: generateKey("field-visibility"),
          kind: "subscriptionPlan",
          planKey: condition.planId ?? condition.planKey ?? "",
        };
      }
      if (condition.kind === "channel") {
        return {
          key: generateKey("field-visibility"),
          kind: "channel",
          channel: condition.channel ?? "",
        };
      }
      return {
        key: generateKey("field-visibility"),
        kind: "channel",
        channel: "",
      };
    }),
  };
}

function serializeVisibilityDraft(
  visibility: CustomFieldVisibilityDraft,
  optionGroups: GroupDraft[],
  addOns: AddOnDraft[],
  subscriptionPlans: PlanDraft[],
): ProductCustomFieldMetadata["conditionalVisibility"] | null {
  if (!visibility.conditions.length) {
    return null;
  }

  const conditions = visibility.conditions
    .map((condition) => {
      if (condition.kind === "option") {
        const group = optionGroups.find((entry) => (entry.id ?? entry.key) === condition.groupKey);
        if (!group) {
          return null;
        }
        const option = group.options.find((entry) => (entry.id ?? entry.key) === condition.optionKey);
        if (!option) {
          return null;
        }
        return {
          kind: "option",
          groupId: group.id ?? undefined,
          groupKey: group.id ? undefined : group.key,
          optionId: option.id ?? undefined,
          optionKey: option.id ? undefined : option.key,
        };
      }
      if (condition.kind === "addOn") {
        const addOn = addOns.find((entry) => (entry.id ?? entry.key) === condition.addOnKey);
        if (!addOn) {
          return null;
        }
        return {
          kind: "addOn",
          addOnId: addOn.id ?? undefined,
          addOnKey: addOn.id ? undefined : addOn.key,
        };
      }
      if (condition.kind === "subscriptionPlan") {
        const plan = subscriptionPlans.find((entry) => (entry.id ?? entry.key) === condition.planKey);
        if (!plan) {
          return null;
        }
        return {
          kind: "subscriptionPlan",
          planId: plan.id ?? undefined,
          planKey: plan.id ? undefined : plan.key,
        };
      }
      if (condition.kind === "channel" && condition.channel.trim().length > 0) {
        return {
          kind: "channel",
          channel: condition.channel.trim(),
        };
      }
      return null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

  if (conditions.length === 0) {
    return null;
  }

  return {
    mode: visibility.mode === "any" ? "any" : "all",
    conditions,
  };
}

function createEmptyCustomFieldDraft(displayOrder: number): MerchCustomFieldDraft {
  return {
    key: generateKey("field"),
    id: null,
    label: "",
    fieldType: "text",
    placeholder: "",
    helpText: "",
    required: false,
    validation: { ...emptyValidationState },
    sampleValues: "",
    defaultValue: "",
    exposeInCheckout: true,
    exposeInFulfillment: true,
    visibility: { ...emptyVisibilityState, conditions: [] },
    regexTester: { ...emptyRegexTesterState },
    displayOrder,
  };
}

function createCustomFieldDraft(field: ProductDetail["customFields"][number], index: number): MerchCustomFieldDraft {
  const metadata = sharedNormalizeCustomFieldMetadata(field.metadataJson ?? {});
  const validationSource =
    metadata.validation ??
    metadata.validationRules ??
    field.validationRules ??
    field.validation ??
    null;
  const regexRule = validationSource?.regex ?? null;
  const passthrough = metadata.passthrough ?? field.passthroughTargets ?? null;
  const sampleValuesString = Array.isArray(metadata.sampleValues) ? metadata.sampleValues.join("\n") : "";
  const allowedValuesString = Array.isArray(validationSource?.allowedValues)
    ? validationSource!.allowedValues!.join("\n")
    : "";

  const defaultValue =
    typeof metadata.defaultValue === "string"
      ? metadata.defaultValue
      : typeof field.defaultValue === "string"
        ? field.defaultValue
        : "";

  return {
    key: generateKey("field"),
    id: field.id ?? null,
    label: field.label,
    fieldType: field.fieldType,
    placeholder: field.placeholder ?? "",
    helpText: metadata.helperText ?? field.helpText ?? "",
    required: field.isRequired,
    validation: {
      ...emptyValidationState,
      minLength:
        typeof validationSource?.minLength === "number" ? String(validationSource.minLength) : "",
      maxLength:
        typeof validationSource?.maxLength === "number" ? String(validationSource.maxLength) : "",
      minValue:
        typeof validationSource?.minValue === "number" ? String(validationSource.minValue) : "",
      maxValue:
        typeof validationSource?.maxValue === "number" ? String(validationSource.maxValue) : "",
      numericStep:
        typeof validationSource?.numericStep === "number" ? String(validationSource.numericStep) : "",
      pattern: validationSource?.pattern ?? "",
      regexFlags: regexRule?.flags ?? "",
      regexDescription: regexRule?.description ?? "",
      disallowWhitespace: Boolean(validationSource?.disallowWhitespace),
      allowedValues: allowedValuesString,
    },
    sampleValues: sampleValuesString,
    defaultValue,
    exposeInCheckout: passthrough?.checkout ?? false,
    exposeInFulfillment: passthrough?.fulfillment ?? false,
    visibility: extractVisibilityDraft(metadata),
    regexTester: {
      sampleValue: metadata.regexTester?.sampleValue ?? regexRule?.sampleValue ?? "",
      lastResult:
        typeof metadata.regexTester?.lastResult === "boolean" ? metadata.regexTester.lastResult : null,
    },
    displayOrder: field.displayOrder ?? index,
  };
}

function buildCustomFieldMetadata(
  field: MerchCustomFieldDraft,
  optionGroups: GroupDraft[],
  addOns: AddOnDraft[],
  subscriptionPlans: PlanDraft[],
): ProductCustomFieldMetadata {
  const metadata: ProductCustomFieldMetadata = {};

  if (field.helpText.trim().length > 0) {
    metadata.helperText = field.helpText.trim();
  }

  const validation: ProductCustomFieldMetadata["validation"] = {};
  const minLength = Number(field.validation.minLength);
  if (field.validation.minLength.trim().length > 0 && Number.isFinite(minLength) && minLength >= 0) {
    validation.minLength = minLength;
  }
  const maxLength = Number(field.validation.maxLength);
  if (field.validation.maxLength.trim().length > 0 && Number.isFinite(maxLength) && maxLength >= 0) {
    validation.maxLength = maxLength;
  }
  const minValue = Number(field.validation.minValue);
  if (field.validation.minValue.trim().length > 0 && Number.isFinite(minValue)) {
    validation.minValue = minValue;
  }
  const maxValue = Number(field.validation.maxValue);
  if (field.validation.maxValue.trim().length > 0 && Number.isFinite(maxValue)) {
    validation.maxValue = maxValue;
  }
  const numericStep = Number(field.validation.numericStep);
  if (field.validation.numericStep.trim().length > 0 && Number.isFinite(numericStep) && numericStep > 0) {
    validation.numericStep = numericStep;
  }
  if (field.validation.pattern.trim().length > 0) {
    validation.pattern = field.validation.pattern.trim();
  }
  if (field.validation.disallowWhitespace) {
    validation.disallowWhitespace = true;
  }
  const allowedValues = parseDelimitedList(field.validation.allowedValues);
  if (allowedValues.length > 0) {
    validation.allowedValues = allowedValues;
  }
  if (field.validation.pattern.trim().length > 0) {
    const regexPayload: NonNullable<ProductCustomFieldMetadata["validation"]>["regex"] = {
      pattern: field.validation.pattern.trim(),
    };
    if (field.validation.regexFlags.trim().length > 0) {
      regexPayload.flags = field.validation.regexFlags.trim();
    }
    if (field.validation.regexDescription.trim().length > 0) {
      regexPayload.description = field.validation.regexDescription.trim();
    }
    if (field.regexTester.sampleValue.trim().length > 0) {
      regexPayload.sampleValue = field.regexTester.sampleValue.trim();
    }
    validation.regex = regexPayload;
  }
  if (Object.keys(validation).length > 0) {
    metadata.validation = validation;
    metadata.validationRules = validation;
  }

  metadata.passthrough = {
    checkout: field.exposeInCheckout,
    fulfillment: field.exposeInFulfillment,
  };

  const samples = parseDelimitedList(field.sampleValues);
  if (samples.length > 0) {
    metadata.sampleValues = samples;
  }

  const defaultValue = field.defaultValue.trim();
  metadata.defaultValue = defaultValue.length > 0 ? defaultValue : null;

  const visibility = serializeVisibilityDraft(field.visibility, optionGroups, addOns, subscriptionPlans);
  if (visibility) {
    metadata.conditionalVisibility = visibility;
    metadata.visibilityRules = visibility;
  }

  const regexTesterSample = field.regexTester.sampleValue.trim();
  const regexTesterLast = typeof field.regexTester.lastResult === "boolean" ? field.regexTester.lastResult : null;
  if (regexTesterSample.length > 0 || regexTesterLast != null) {
    metadata.regexTester = {
      sampleValue: regexTesterSample.length > 0 ? regexTesterSample : null,
      lastResult: regexTesterLast,
    };
  }

  return metadata;
}

type OptionMatrixEditorProps = {
  product: ProductDetail;
  csrfToken: string;
};

type SubmitButtonProps = {
  disabled?: boolean;
};

function SubmitButton({ disabled }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending || disabled}
    >
      {pending ? "Publishing..." : "Publish configuration"}
    </button>
  );
}

function toGroupDrafts(groups: ProductDetail["optionGroups"]): GroupDraft[] {
  return groups.map((group) => ({
    key: generateKey("group"),
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    groupType: group.groupType,
    isRequired: group.isRequired,
    displayOrder: group.displayOrder ?? 0,
    metadata: group.metadataJson ?? {},
    options: group.options.map((option) => ({
      key: generateKey("option"),
      id: option.id,
      name: option.label,
      description: option.description ?? "",
      priceDelta: option.priceDelta,
      displayOrder: option.displayOrder ?? 0,
      recommended: option.metadataJson?.recommended === true,
      metadata: option.metadataJson ?? {},
    })),
  }));
}

function toAddOnDrafts(addOns: ProductDetail["addOns"]): AddOnDraft[] {
  return addOns.map((addOn) => ({
    key: generateKey("addon"),
    id: addOn.id,
    label: addOn.label,
    description: addOn.description ?? "",
    priceDelta: addOn.priceDelta,
    isRecommended: addOn.isRecommended,
    displayOrder: addOn.displayOrder ?? 0,
  }));
}

function toCustomFieldDrafts(fields: ProductDetail["customFields"]): MerchCustomFieldDraft[] {
  if (!fields.length) {
    return [];
  }
  return fields.map((field, index) => createCustomFieldDraft(field, index));
}

function toPlanDrafts(plans: ProductDetail["subscriptionPlans"]): PlanDraft[] {
  return plans.map((plan) => ({
    key: generateKey("plan"),
    id: plan.id,
    label: plan.label,
    description: plan.description ?? "",
    billingCycle: plan.billingCycle,
    priceMultiplier: plan.priceMultiplier ?? null,
    priceDelta: plan.priceDelta ?? null,
    isDefault: plan.isDefault,
    displayOrder: plan.displayOrder ?? 0,
  }));
}

function toPresetDrafts(
  presets: ProductDetail["configurationPresets"],
): ConfigurationPresetDraft[] {
  return presets.map((preset, index) => ({
    key: generateKey("preset"),
    id: preset.id,
    label: preset.label,
    summary: preset.summary ?? "",
    heroImageUrl: preset.heroImageUrl ?? "",
    badge: preset.badge ?? "",
    priceHint: preset.priceHint ?? "",
    displayOrder: preset.displayOrder ?? index,
    selection: {
      optionSelections: Object.fromEntries(
        Object.entries(preset.selection.optionSelections).map(([groupId, values]) => [
          groupId,
          [...values],
        ]),
      ),
      addOnIds: [...preset.selection.addOnIds],
      subscriptionPlanId: preset.selection.subscriptionPlanId ?? null,
      customFieldValues: { ...preset.selection.customFieldValues },
    },
  }));
}

function mapGroupsToConfigurator(groups: GroupDraft[]): ConfiguratorOptionGroup[] {
  return groups
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((group) => ({
      id: group.id ?? group.key,
      name: group.name,
      description: group.description || undefined,
      type: group.groupType,
      required: group.isRequired,
      metadata: group.metadata ?? null,
      options: group.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((option) => ({
          id: option.id ?? option.key,
          label: option.name,
          description: option.description || undefined,
          priceDelta: option.priceDelta,
          recommended: option.recommended,
          metadata: option.metadata ?? null,
        })),
    }));
}

function mapAddOnsToConfigurator(addOns: AddOnDraft[]): ConfiguratorAddOn[] {
  return addOns
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((addOn) => ({
      id: addOn.id ?? addOn.key,
      label: addOn.label,
      description: addOn.description || undefined,
      priceDelta: addOn.priceDelta,
      recommended: addOn.isRecommended,
      metadata: null,
      metadataJson: null,
      pricing: null,
      computedDelta: addOn.priceDelta,
      percentageMultiplier: null,
    }));
}

function mapFieldsToConfigurator(
  fields: MerchCustomFieldDraft[],
  optionGroups: GroupDraft[],
  addOns: AddOnDraft[],
  subscriptionPlans: PlanDraft[],
): ConfiguratorCustomField[] {
  return fields
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((field) => ({
      id: field.id ?? field.key,
      label: field.label,
      type: field.fieldType,
      placeholder: field.placeholder || undefined,
      helpText: field.helpText || undefined,
      required: field.required,
      validation: (() => {
        const validation: ConfiguratorCustomField["validation"] = {};
        const minLength = Number(field.validation.minLength);
        if (field.validation.minLength.trim().length > 0 && Number.isFinite(minLength) && minLength >= 0) {
          validation.minLength = minLength;
        }
        const maxLength = Number(field.validation.maxLength);
        if (field.validation.maxLength.trim().length > 0 && Number.isFinite(maxLength) && maxLength >= 0) {
          validation.maxLength = maxLength;
        }
        const minValue = Number(field.validation.minValue);
        if (field.validation.minValue.trim().length > 0 && Number.isFinite(minValue)) {
          validation.minValue = minValue;
        }
        const maxValue = Number(field.validation.maxValue);
        if (field.validation.maxValue.trim().length > 0 && Number.isFinite(maxValue)) {
          validation.maxValue = maxValue;
        }
        const numericStep = Number(field.validation.numericStep);
        if (field.validation.numericStep.trim().length > 0 && Number.isFinite(numericStep) && numericStep > 0) {
          validation.numericStep = numericStep;
        }
        if (field.validation.pattern.trim().length > 0) {
          validation.pattern = field.validation.pattern.trim();
          const regexPayload: ConfiguratorCustomField["validation"]["regex"] = {
            pattern: field.validation.pattern.trim(),
          };
          if (field.validation.regexFlags.trim().length > 0) {
            regexPayload.flags = field.validation.regexFlags.trim();
          }
          if (field.validation.regexDescription.trim().length > 0) {
            regexPayload.description = field.validation.regexDescription.trim();
          }
          validation.regex = regexPayload;
        }
        if (field.validation.disallowWhitespace) {
          validation.disallowWhitespace = true;
        }
        const allowedValues = parseDelimitedList(field.validation.allowedValues);
        if (allowedValues.length > 0) {
          validation.allowedValues = allowedValues;
        }
        return Object.keys(validation).length > 0 ? validation : undefined;
      })(),
      passthrough: field.exposeInFulfillment ? { fulfillment: true } : undefined,
      defaultValue: field.defaultValue.trim().length > 0 ? field.defaultValue.trim() : undefined,
      conditional: (() => {
        const descriptor = serializeVisibilityDraft(field.visibility, optionGroups, addOns, subscriptionPlans);
        if (!descriptor) {
          return undefined;
        }
        return {
          mode: descriptor.mode,
          conditions: descriptor.conditions,
        };
      })(),
      sampleValues: (() => {
        const samples = parseDelimitedList(field.sampleValues);
        return samples.length > 0 ? samples : undefined;
      })(),
    }));
}

function mapPlansToConfigurator(plans: PlanDraft[]): ConfiguratorSubscriptionPlan[] {
  return plans
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((plan) => ({
      id: plan.id ?? plan.key,
      label: plan.label,
      description: plan.description || undefined,
      billingCycle: plan.billingCycle === "one_time" ? "one-time" : plan.billingCycle,
      priceMultiplier: plan.priceMultiplier ?? undefined,
      priceDelta: plan.priceDelta ?? undefined,
      default: plan.isDefault,
    }));
}

export function OptionMatrixEditor({ product, csrfToken }: OptionMatrixEditorProps) {
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    product.optionGroups.length > 0 ? toGroupDrafts(product.optionGroups) : []
  );
  const [addOns, setAddOns] = useState<AddOnDraft[]>(() => toAddOnDrafts(product.addOns));
  const [customFields, setCustomFields] = useState<MerchCustomFieldDraft[]>(() =>
    toCustomFieldDrafts(product.customFields)
  );
  const [subscriptionPlans, setSubscriptionPlans] = useState<PlanDraft[]>(() =>
    toPlanDrafts(product.subscriptionPlans)
  );
  const [configurationPresets, setConfigurationPresets] = useState<ConfigurationPresetDraft[]>(() =>
    toPresetDrafts(product.configurationPresets ?? []),
  );
  const [previewTotal, setPreviewTotal] = useState<number>(product.basePrice);
  const [selectionSnapshot, setSelectionSnapshot] = useState<ConfiguratorSelection | null>(null);

  const [state, action] = useFormState(updateProductConfigurationAction, initialActionState);

  const selectableGroupOptionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    groups.forEach((group) => {
      if (!group.id) {
        return;
      }
      const optionIds = new Set(
        group.options
          .map((option) => (option.id ? String(option.id) : null))
          .filter((id): id is string => Boolean(id)),
      );
      map.set(String(group.id), optionIds);
    });
    return map;
  }, [groups]);

  const selectableAddOnIds = useMemo(
    () =>
      new Set(
        addOns
          .map((addOn) => (addOn.id ? String(addOn.id) : null))
          .filter((id): id is string => Boolean(id)),
      ),
    [addOns],
  );

  const selectablePlanIds = useMemo(
    () =>
      new Set(
        subscriptionPlans
          .map((plan) => (plan.id ? String(plan.id) : null))
          .filter((id): id is string => Boolean(id)),
      ),
    [subscriptionPlans],
  );

  const selectableFieldIds = useMemo(
    () =>
      new Set(
        customFields
          .map((field) => (field.id ? String(field.id) : null))
          .filter((id): id is string => Boolean(id)),
      ),
    [customFields],
  );

  const ensureDefaultPlan = useCallback((plans: PlanDraft[]): PlanDraft[] => {
    if (!plans.some((plan) => plan.isDefault) && plans.length > 0) {
      const [first, ...rest] = plans;
      return [{ ...first, isDefault: true }, ...rest];
    }
    return plans;
  }, []);

  const buildPresetSelectionFromSnapshot = useCallback(
    (snapshot: ConfiguratorSelection): PresetSelectionDraft => {
      const optionSelections: Record<string, string[]> = {};
      Object.entries(snapshot.selectedOptions).forEach(([groupId, optionIds]) => {
        if (!selectableGroupOptionMap.has(groupId)) {
          return;
        }
        const allowed = selectableGroupOptionMap.get(groupId)!;
        const normalized = optionIds.filter((optionId) => allowed.has(optionId));
        if (normalized.length > 0) {
          optionSelections[groupId] = normalized;
        }
      });

      const addOnIds = snapshot.addOns.filter((id) => selectableAddOnIds.has(id));
      const subscriptionPlanId =
        snapshot.subscriptionPlanId && selectablePlanIds.has(snapshot.subscriptionPlanId)
          ? snapshot.subscriptionPlanId
          : null;
      const customFieldValues: Record<string, string> = {};
      Object.entries(snapshot.customFieldValues).forEach(([fieldId, value]) => {
        if (selectableFieldIds.has(fieldId)) {
          customFieldValues[fieldId] = value;
        }
      });

      return {
        optionSelections,
        addOnIds,
        subscriptionPlanId,
        customFieldValues,
      };
    },
    [selectableAddOnIds, selectableFieldIds, selectableGroupOptionMap, selectablePlanIds],
  );

  const addConfigurationPreset = useCallback(() => {
    setConfigurationPresets((prev) => [
      ...prev,
      {
        key: generateKey("preset"),
        id: null,
        label: "Configuration preset",
        summary: "",
        heroImageUrl: "",
        badge: "",
        priceHint: "",
        displayOrder: prev.length,
        selection: {
          optionSelections: {},
          addOnIds: [],
          subscriptionPlanId: null,
          customFieldValues: {},
        },
      },
    ]);
  }, []);

  const addPresetFromSnapshot = useCallback(() => {
    if (!selectionSnapshot) {
      return;
    }
    const selection = buildPresetSelectionFromSnapshot(selectionSnapshot);
    setConfigurationPresets((prev) => [
      ...prev,
      {
        key: generateKey("preset"),
        id: null,
        label: "Configuration preset",
        summary: "",
        heroImageUrl: "",
        badge: "",
        priceHint: "",
        displayOrder: prev.length,
        selection,
      },
    ]);
  }, [buildPresetSelectionFromSnapshot, selectionSnapshot]);

  const updatePreset = useCallback(
    (presetKey: string, updater: (preset: ConfigurationPresetDraft) => ConfigurationPresetDraft) => {
      setConfigurationPresets((prev) => prev.map((preset) => (preset.key === presetKey ? updater(preset) : preset)));
    },
    [],
  );

  const removePreset = useCallback((presetKey: string) => {
    setConfigurationPresets((prev) => prev.filter((preset) => preset.key !== presetKey));
  }, []);

  const applySnapshotToPreset = useCallback(
    (presetKey: string) => {
      if (!selectionSnapshot) {
        return;
      }
      const selection = buildPresetSelectionFromSnapshot(selectionSnapshot);
      updatePreset(presetKey, (preset) => ({
        ...preset,
        selection,
      }));
    },
    [buildPresetSelectionFromSnapshot, selectionSnapshot, updatePreset],
  );

  const togglePresetOption = useCallback(
    (presetKey: string, groupId: string, optionId: string) => {
      if (!selectableGroupOptionMap.has(groupId) || !selectableGroupOptionMap.get(groupId)?.has(optionId)) {
        return;
      }
      updatePreset(presetKey, (preset) => {
        const current = new Set(preset.selection.optionSelections[groupId] ?? []);
        if (current.has(optionId)) {
          current.delete(optionId);
        } else {
          current.add(optionId);
        }
        const nextSelections = { ...preset.selection.optionSelections };
        if (current.size === 0) {
          delete nextSelections[groupId];
        } else {
          nextSelections[groupId] = Array.from(current);
        }
        return {
          ...preset,
          selection: {
            ...preset.selection,
            optionSelections: nextSelections,
          },
        };
      });
    },
    [selectableGroupOptionMap, updatePreset],
  );

  const togglePresetAddOn = useCallback(
    (presetKey: string, addOnId: string) => {
      if (!selectableAddOnIds.has(addOnId)) {
        return;
      }
      updatePreset(presetKey, (preset) => {
        const next = new Set(preset.selection.addOnIds);
        if (next.has(addOnId)) {
          next.delete(addOnId);
        } else {
          next.add(addOnId);
        }
        return {
          ...preset,
          selection: {
            ...preset.selection,
            addOnIds: Array.from(next),
          },
        };
      });
    },
    [selectableAddOnIds, updatePreset],
  );

  const setPresetSubscriptionPlan = useCallback(
    (presetKey: string, planId: string | null) => {
      if (planId && !selectablePlanIds.has(planId)) {
        return;
      }
      updatePreset(presetKey, (preset) => ({
        ...preset,
        selection: {
          ...preset.selection,
          subscriptionPlanId: planId,
        },
      }));
    },
    [selectablePlanIds, updatePreset],
  );

  const updatePresetCustomField = useCallback(
    (presetKey: string, fieldId: string, value: string) => {
      if (!selectableFieldIds.has(fieldId)) {
        return;
      }
      updatePreset(presetKey, (preset) => ({
        ...preset,
        selection: {
          ...preset.selection,
          customFieldValues: {
            ...preset.selection.customFieldValues,
            [fieldId]: value,
          },
        },
      }));
    },
    [selectableFieldIds, updatePreset],
  );

  const addGroup = useCallback(() => {
    setGroups((prev) => [
      ...prev,
      {
        key: generateKey("group"),
        id: null,
        name: "New configuration group",
        description: "",
        groupType: "single",
        isRequired: false,
        displayOrder: prev.length,
        metadata: {},
        options: [
          {
            key: generateKey("option"),
            id: null,
            name: "Option",
            description: "",
            priceDelta: 0,
            displayOrder: 0,
            recommended: prev.length === 0,
            metadata: {},
          },
        ],
      },
    ]);
  }, []);

  const updateGroup = useCallback((key: string, updater: (group: GroupDraft) => GroupDraft) => {
    setGroups((prev) => prev.map((group) => (group.key === key ? updater(group) : group)));
  }, []);

  const removeGroup = useCallback((key: string) => {
    setGroups((prev) => prev.filter((group) => group.key !== key));
  }, []);

  const addOptionToGroup = useCallback((groupKey: string) => {
    updateGroup(groupKey, (group) => ({
      ...group,
      options: [
        ...group.options,
        {
          key: generateKey("option"),
          id: null,
          name: "Option",
          description: "",
          priceDelta: 0,
          displayOrder: group.options.length,
          recommended: false,
          metadata: {},
        },
      ],
    }));
  }, [updateGroup]);

  const updateOption = useCallback(
    (groupKey: string, optionKey: string, updater: (option: OptionDraft) => OptionDraft) => {
      updateGroup(groupKey, (group) => ({
        ...group,
        options: group.options.map((option) =>
          option.key === optionKey ? updater(option) : option
        ),
      }));
    },
    [updateGroup],
  );

  const removeOption = useCallback(
    (groupKey: string, optionKey: string) => {
      updateGroup(groupKey, (group) => ({
        ...group,
        options: group.options.filter((option) => option.key !== optionKey),
      }));
    },
    [updateGroup],
  );

  const addAddOn = useCallback(() => {
    setAddOns((prev) => [
      ...prev,
      {
        key: generateKey("addon"),
        id: null,
        label: "Add-on",
        description: "",
        priceDelta: 0,
        isRecommended: false,
        displayOrder: prev.length,
      },
    ]);
  }, []);

  const updateAddOn = useCallback((key: string, updater: (addOn: AddOnDraft) => AddOnDraft) => {
    setAddOns((prev) => prev.map((addOn) => (addOn.key === key ? updater(addOn) : addOn)));
  }, []);

  const removeAddOn = useCallback((key: string) => {
    setAddOns((prev) => prev.filter((addOn) => addOn.key !== key));
  }, []);

  const addCustomField = useCallback(() => {
    setCustomFields((prev) => [...prev, createEmptyCustomFieldDraft(prev.length)]);
  }, []);

  const updateCustomField = useCallback(
    (key: string, updater: (field: MerchCustomFieldDraft) => MerchCustomFieldDraft) => {
      setCustomFields((prev) => prev.map((field) => (field.key === key ? updater(field) : field)));
    },
    [],
  );

  const updateCustomFieldValidation = useCallback(
    (key: string, patch: Partial<CustomFieldDraft["validation"]>) => {
      setCustomFields((prev) =>
        prev.map((field) =>
          field.key === key
            ? {
                ...field,
                validation: { ...field.validation, ...patch },
              }
            : field,
        ),
      );
    },
    [],
  );

  const updateRegexTester = useCallback(
    (key: string, patch: Partial<CustomFieldDraft["regexTester"]>) => {
      setCustomFields((prev) =>
        prev.map((field) =>
          field.key === key
            ? {
                ...field,
                regexTester: { ...field.regexTester, ...patch },
              }
            : field,
        ),
      );
    },
    [],
  );

  const removeCustomField = useCallback((key: string) => {
    setCustomFields((prev) => prev.filter((field) => field.key !== key));
  }, []);

  const addPlan = useCallback(() => {
    setSubscriptionPlans((prev) =>
      ensureDefaultPlan([
        ...prev,
        {
          key: generateKey("plan"),
          id: null,
          label: "Plan",
          description: "",
          billingCycle: "one_time",
          priceMultiplier: null,
          priceDelta: null,
          isDefault: prev.length === 0,
          displayOrder: prev.length,
        },
      ])
    );
  }, [ensureDefaultPlan]);

  const updatePlan = useCallback(
    (key: string, updater: (plan: PlanDraft) => PlanDraft) => {
      setSubscriptionPlans((prev) => {
        const updatedPlans = prev.map((plan) => (plan.key === key ? updater(plan) : plan));
        const target = updatedPlans.find((plan) => plan.key === key);
        if (target?.isDefault) {
          return updatedPlans.map((plan) =>
            plan.key === key ? { ...plan, isDefault: true } : { ...plan, isDefault: false },
          );
        }
        return ensureDefaultPlan(updatedPlans);
      });
    },
    [ensureDefaultPlan],
  );

  const removePlan = useCallback((key: string) => {
    setSubscriptionPlans((prev) => ensureDefaultPlan(prev.filter((plan) => plan.key !== key)));
  }, [ensureDefaultPlan]);

  const normalizedConfigurationPresets = useMemo(() => {
    return configurationPresets.map((preset, index) => {
      const optionSelections: Record<string, string[]> = {};
      Object.entries(preset.selection.optionSelections).forEach(([groupId, optionIds]) => {
        if (!selectableGroupOptionMap.has(groupId)) {
          return;
        }
        const allowed = selectableGroupOptionMap.get(groupId)!;
        const filtered = optionIds.filter((id) => allowed.has(id));
        if (filtered.length > 0) {
          optionSelections[groupId] = filtered;
        }
      });
      const addOnIds = preset.selection.addOnIds.filter((id) => selectableAddOnIds.has(id));
      const subscriptionPlanId =
        preset.selection.subscriptionPlanId && selectablePlanIds.has(preset.selection.subscriptionPlanId)
          ? preset.selection.subscriptionPlanId
          : null;
      const customFieldValues = Object.fromEntries(
        Object.entries(preset.selection.customFieldValues).filter(([fieldId]) =>
          selectableFieldIds.has(fieldId),
        ),
      );

      return {
        id: preset.id,
        label: preset.label.trim() || `Preset ${index + 1}`,
        summary: preset.summary.trim() || null,
        heroImageUrl: preset.heroImageUrl.trim() || null,
        badge: preset.badge.trim() || null,
        priceHint: preset.priceHint.trim() || null,
        displayOrder: Number.isFinite(preset.displayOrder) ? preset.displayOrder : index,
        selection: {
          optionSelections,
          addOnIds,
          subscriptionPlanId,
          customFieldValues,
        },
      };
    });
  }, [
    configurationPresets,
    selectableAddOnIds,
    selectableFieldIds,
    selectableGroupOptionMap,
    selectablePlanIds,
  ]);

  const configurationPayload = useMemo(() => {
    return {
      optionGroups: groups.map((group, index) => ({
        id: group.id,
        name: group.name.trim() || `Group ${index + 1}`,
        description: group.description.trim() || null,
        groupType: group.groupType,
        isRequired: group.isRequired,
        displayOrder: Number.isFinite(group.displayOrder) ? group.displayOrder : index,
        metadata: group.metadata,
        options: group.options.map((option, optionIndex) => {
          const metadata = { ...option.metadata } as Record<string, unknown>;
          if (option.recommended) {
            metadata.recommended = true;
          } else if ("recommended" in metadata) {
            delete (metadata as Record<string, unknown>).recommended;
          }
          return {
            id: option.id,
            name: option.name.trim() || `Option ${optionIndex + 1}`,
            description: option.description.trim() || null,
            priceDelta: Number.isFinite(option.priceDelta) ? option.priceDelta : 0,
            displayOrder: Number.isFinite(option.displayOrder) ? option.displayOrder : optionIndex,
            metadata,
          };
        }),
      })),
      addOns: addOns.map((addOn, index) => ({
        id: addOn.id,
        label: addOn.label.trim() || `Add-on ${index + 1}`,
        description: addOn.description.trim() || null,
        priceDelta: Number.isFinite(addOn.priceDelta) ? addOn.priceDelta : 0,
        isRecommended: addOn.isRecommended,
        displayOrder: Number.isFinite(addOn.displayOrder) ? addOn.displayOrder : index,
      })),
      customFields: customFields.map((field, index) => {
        const metadata = buildCustomFieldMetadata(field, groups, addOns, subscriptionPlans);
        const serializedMetadata = sharedSerializeCustomFieldMetadata(metadata);
        const hasMetadata = Object.keys(serializedMetadata).length > 0;
        return {
          id: field.id,
          label: field.label.trim() || `Field ${index + 1}`,
          fieldType: field.fieldType,
          placeholder: field.placeholder.trim() || null,
          helpText: field.helpText.trim() || null,
          isRequired: field.required,
          displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
          metadata: hasMetadata ? serializedMetadata : null,
        };
      }),
      subscriptionPlans: subscriptionPlans.map((plan, index) => ({
        id: plan.id,
        label: plan.label.trim() || `Plan ${index + 1}`,
        description: plan.description.trim() || null,
        billingCycle: plan.billingCycle,
        priceMultiplier:
          plan.priceMultiplier != null && Number.isFinite(plan.priceMultiplier)
            ? plan.priceMultiplier
            : null,
        priceDelta:
          plan.priceDelta != null && Number.isFinite(plan.priceDelta)
            ? plan.priceDelta
            : null,
        isDefault: plan.isDefault,
        displayOrder: Number.isFinite(plan.displayOrder) ? plan.displayOrder : index,
      })),
      configurationPresets: normalizedConfigurationPresets,
    };
  }, [
    addOns,
    customFields,
    groups,
    subscriptionPlans,
    normalizedConfigurationPresets,
  ]);

  const serializedConfiguration = useMemo(
    () => JSON.stringify(configurationPayload),
    [configurationPayload],
  );

  const configuratorGroups = useMemo(() => mapGroupsToConfigurator(groups), [groups]);
  const configuratorAddOns = useMemo(() => mapAddOnsToConfigurator(addOns), [addOns]);
  const configuratorFields = useMemo(
    () => mapFieldsToConfigurator(customFields, groups, addOns, subscriptionPlans),
    [customFields, groups, addOns, subscriptionPlans],
  );
  const configuratorPlans = useMemo(() => mapPlansToConfigurator(subscriptionPlans), [subscriptionPlans]);
  const previewConfigurationPresets = useMemo<ConfiguratorPreset[]>(() => {
    return normalizedConfigurationPresets.map((preset, index) => ({
      id: preset.id ?? `draft-preset-${index}`,
      label: preset.label,
      summary: preset.summary,
      heroImageUrl: preset.heroImageUrl ?? undefined,
      badge: preset.badge ?? undefined,
      priceHint: preset.priceHint ?? undefined,
      displayOrder: preset.displayOrder,
      selection: {
        optionSelections: preset.selection.optionSelections,
        addOnIds: preset.selection.addOnIds,
        subscriptionPlanId: preset.selection.subscriptionPlanId ?? undefined,
        customFieldValues: preset.selection.customFieldValues,
      },
    }));
  }, [normalizedConfigurationPresets]);
  const presetValidationMap = useMemo(() => {
    const issues: Record<string, string[]> = {};
    const labelMap = new Map<string, string>();

    configurationPresets.forEach((preset, index) => {
      const errors: string[] = [];
      const trimmedLabel = preset.label.trim();
      if (trimmedLabel.length === 0) {
        errors.push("Label is required.");
      } else {
        const normalized = trimmedLabel.toLowerCase();
        const existing = labelMap.get(normalized);
        if (existing) {
          errors.push("Label duplicates another preset.");
          issues[existing] = [...(issues[existing] ?? []), "Label duplicates another preset."];
        } else {
          labelMap.set(normalized, preset.key);
        }
      }

      const hasSelections =
        Object.keys(preset.selection.optionSelections).length > 0 ||
        preset.selection.addOnIds.length > 0 ||
        (preset.selection.subscriptionPlanId != null && preset.selection.subscriptionPlanId !== "") ||
        Object.keys(preset.selection.customFieldValues).length > 0;
      if (!hasSelections) {
        errors.push("Add at least one selection (option, add-on, plan, or field value).");
      }

      if (errors.length > 0) {
        issues[preset.key] = errors;
      }
    });

    return issues;
  }, [configurationPresets]);
  const hasPresetValidationErrors = Object.keys(presetValidationMap).length > 0;

  return (
    <form action={action} className="space-y-6 rounded-3xl border border-white/10 bg-black/30 p-6">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="configuration" value={serializedConfiguration} />

      <header className="space-y-2">
        <h3 className="text-lg font-semibold text-white">Option matrix builder</h3>
        <p className="text-sm text-white/60">
          Configure selectable bundles, price deltas, and guardrail fields. Operators can preview the
          resulting checkout experience before publishing.
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-white">Option groups</h4>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            onClick={addGroup}
          >
            Add group
          </button>
        </div>
        <div className="space-y-4">
          {groups.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No groups yet. Add a configuration group to start composing the option matrix.
            </p>
          ) : (
            groups.map((group, groupIndex) => (
              <div
                key={group.key}
                className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Group {groupIndex + 1}</p>
                    <h5 className="text-sm font-semibold text-white">{group.name || "Unnamed group"}</h5>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-red-500/40 px-3 py-1 text-xs uppercase tracking-[0.3em] text-red-200 transition hover:border-red-400 hover:text-red-100"
                      onClick={() => removeGroup(group.key)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Name</span>
                    <input
                      type="text"
                      value={group.name}
                      onChange={(event) =>
                        updateGroup(group.key, (current) => ({ ...current, name: event.target.value }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Description</span>
                    <input
                      type="text"
                      value={group.description}
                      onChange={(event) =>
                        updateGroup(group.key, (current) => ({ ...current, description: event.target.value }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                    <input
                      type="number"
                      value={group.displayOrder}
                      onChange={(event) =>
                        updateGroup(group.key, (current) => ({
                          ...current,
                          displayOrder: Number(event.target.value ?? group.displayOrder) || 0,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.3em] text-white/40">
                      <span>Selection type</span>
                      <select
                        value={group.groupType}
                        onChange={(event) =>
                          updateGroup(group.key, (current) => ({
                            ...current,
                            groupType: event.target.value === "multiple" ? "multiple" : "single",
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/40"
                      >
                        <option value="single">Single choice</option>
                        <option value="multiple">Multiple choice</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/40">
                      <input
                        type="checkbox"
                        checked={group.isRequired}
                        onChange={(event) =>
                          updateGroup(group.key, (current) => ({
                            ...current,
                            isRequired: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border border-white/30 bg-black/60"
                      />
                      Required
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Options</p>
                  <div className="space-y-3">
                    {group.options.map((option, optionIndex) => (
                      <div
                        key={option.key}
                        className="grid gap-3 rounded-xl border border-white/10 bg-black/50 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <div className="flex flex-col gap-2 text-sm text-white/70">
                          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                          <input
                            type="text"
                            value={option.name}
                            onChange={(event) =>
                              updateOption(group.key, option.key, (current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                          />
                        </div>
                        <div className="flex flex-col gap-2 text-sm text-white/70">
                          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Narrative</span>
                          <input
                            type="text"
                            value={option.description}
                            onChange={(event) =>
                              updateOption(group.key, option.key, (current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                          />
                        </div>
                        <div className="flex flex-col gap-2 text-sm text-white/70">
                          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Price delta</span>
                          <input
                            type="number"
                            value={option.priceDelta}
                            onChange={(event) =>
                              updateOption(group.key, option.key, (current) => ({
                                ...current,
                                priceDelta: Number(event.target.value ?? option.priceDelta) || 0,
                              }))
                            }
                            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                          />
                        </div>
                        <div className="space-y-2 text-xs uppercase tracking-[0.3em] text-white/40">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={option.recommended}
                              onChange={(event) =>
                                updateOption(group.key, option.key, (current) => ({
                                  ...current,
                                  recommended: event.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border border-white/30 bg-black/60"
                            />
                            Recommended
                          </label>
                          <label className="flex flex-col gap-2 text-sm text-white/70">
                            <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                            <input
                              type="number"
                              value={option.displayOrder}
                              onChange={(event) =>
                                updateOption(group.key, option.key, (current) => ({
                                  ...current,
                                  displayOrder: Number(event.target.value ?? option.displayOrder) || optionIndex,
                                }))
                              }
                              className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removeOption(group.key, option.key)}
                            className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                          >
                            Remove option
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                    onClick={() => addOptionToGroup(group.key)}
                  >
                    Add option
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-white">Add-ons</h4>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            onClick={addAddOn}
          >
            Add add-on
          </button>
        </div>
        <div className="space-y-3">
          {addOns.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No add-ons configured.
            </p>
          ) : (
            addOns.map((addOn, index) => (
              <div key={addOn.key} className="grid gap-3 rounded-xl border border-white/10 bg-black/50 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                  <input
                    type="text"
                    value={addOn.label}
                    onChange={(event) =>
                      updateAddOn(addOn.key, (current) => ({ ...current, label: event.target.value }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Narrative</span>
                  <input
                    type="text"
                    value={addOn.description}
                    onChange={(event) =>
                      updateAddOn(addOn.key, (current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Price delta</span>
                  <input
                    type="number"
                    value={addOn.priceDelta}
                    onChange={(event) =>
                      updateAddOn(addOn.key, (current) => ({
                        ...current,
                        priceDelta: Number(event.target.value ?? addOn.priceDelta) || 0,
                      }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                  />
                </label>
                <div className="space-y-2 text-xs uppercase tracking-[0.3em] text-white/40">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={addOn.isRecommended}
                      onChange={(event) =>
                        updateAddOn(addOn.key, (current) => ({
                          ...current,
                          isRecommended: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border border-white/30 bg-black/60"
                    />
                    Recommended
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                    <input
                      type="number"
                      value={addOn.displayOrder}
                      onChange={(event) =>
                        updateAddOn(addOn.key, (current) => ({
                          ...current,
                          displayOrder: Number(event.target.value ?? addOn.displayOrder) || index,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeAddOn(addOn.key)}
                    className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-base font-semibold text-white">Custom fields</h4>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            onClick={addCustomField}
          >
            Add field
          </button>
        </div>
        <div className="space-y-4">
          {customFields.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No custom fields configured.
            </p>
          ) : (
            customFields.map((field, index) => (
              <div key={field.key} className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Field type</span>
                    <select
                      value={field.fieldType}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          fieldType:
                            event.target.value === "url"
                              ? "url"
                              : event.target.value === "number"
                                ? "number"
                                : "text",
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/40"
                    >
                      <option value="text">Text</option>
                      <option value="url">URL</option>
                      <option value="number">Number</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                    <input
                      type="number"
                      value={field.displayOrder}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          displayOrder: Number(event.target.value ?? field.displayOrder) || index,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Placeholder</span>
                    <input
                      type="text"
                      value={field.placeholder}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          placeholder: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Help text</span>
                    <input
                      type="text"
                      value={field.helpText}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          helpText: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Default value</span>
                    <input
                      type="text"
                      value={field.defaultValue}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          defaultValue: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.3em] text-white/40">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          required: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border border-white/30 bg-black/60"
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.exposeInCheckout}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          exposeInCheckout: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border border-white/30 bg-black/60"
                    />
                    Checkout passthrough
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.exposeInFulfillment}
                      onChange={(event) =>
                        updateCustomField(field.key, (current) => ({
                          ...current,
                          exposeInFulfillment: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border border-white/30 bg-black/60"
                    />
                    Fulfillment passthrough
                  </label>
                </div>

                <FieldValidationPanel
                  field={field}
                  onValidationChange={(patch) => updateCustomFieldValidation(field.key, patch)}
                  onSampleValuesChange={(value) =>
                    updateCustomField(field.key, (current) => ({
                      ...current,
                      sampleValues: value,
                    }))
                  }
                  onRegexTesterChange={(patch) => updateRegexTester(field.key, patch)}
                />

                <div className="flex items-center justify-between">
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                    ID: {field.id ?? "draft"}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeCustomField(field.key)}
                    className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                  >
                    Remove field
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-white">Subscription plans</h4>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            onClick={addPlan}
          >
            Add plan
          </button>
        </div>
        <div className="space-y-3">
          {subscriptionPlans.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No subscription plans configured.
            </p>
          ) : (
            subscriptionPlans.map((plan, index) => (
              <div key={plan.key} className="grid gap-3 rounded-xl border border-white/10 bg-black/50 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                  <input
                    type="text"
                    value={plan.label}
                    onChange={(event) =>
                      updatePlan(plan.key, (current) => ({ ...current, label: event.target.value }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Narrative</span>
                  <input
                    type="text"
                    value={plan.description}
                    onChange={(event) =>
                      updatePlan(plan.key, (current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/70">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Billing cycle</span>
                  <select
                    value={plan.billingCycle}
                    onChange={(event) =>
                      updatePlan(plan.key, (current) => ({
                        ...current,
                        billingCycle:
                          event.target.value === "monthly"
                            ? "monthly"
                            : event.target.value === "quarterly"
                              ? "quarterly"
                              : event.target.value === "annual"
                                ? "annual"
                                : "one_time",
                      }))
                    }
                    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/40"
                  >
                    <option value="one_time">One-time</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
                <div className="space-y-2 text-xs uppercase tracking-[0.3em] text-white/40">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={plan.isDefault}
                      onChange={(event) =>
                        updatePlan(plan.key, (current) => ({
                          ...current,
                          isDefault: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border border-white/30 bg-black/60"
                    />
                    Default
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Price multiplier</span>
                    <input
                      type="number"
                      step="0.01"
                      value={plan.priceMultiplier ?? ""}
                      onChange={(event) =>
                        updatePlan(plan.key, (current) => ({
                          ...current,
                          priceMultiplier:
                            event.target.value === "" ? null : Number(event.target.value ?? current.priceMultiplier),
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Price delta</span>
                    <input
                      type="number"
                      value={plan.priceDelta ?? ""}
                      onChange={(event) =>
                        updatePlan(plan.key, (current) => ({
                          ...current,
                          priceDelta:
                            event.target.value === "" ? null : Number(event.target.value ?? current.priceDelta),
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-white/70">
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                    <input
                      type="number"
                      value={plan.displayOrder}
                      onChange={(event) =>
                        updatePlan(plan.key, (current) => ({
                          ...current,
                          displayOrder: Number(event.target.value ?? plan.displayOrder) || index,
                        }))
                      }
                      className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removePlan(plan.key)}
                    className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-base font-semibold text-white">Configuration presets</h4>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              onClick={addConfigurationPreset}
            >
              Add preset
            </button>
            <button
              type="button"
              disabled={!selectionSnapshot}
              className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              onClick={addPresetFromSnapshot}
            >
              Capture preview
            </button>
          </div>
        </div>
        {hasPresetValidationErrors ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            Resolve the highlighted preset issues before publishing.
          </div>
        ) : null}
        <div className="space-y-4">
          {configurationPresets.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No presets yet. Capture the current configurator snapshot or author a preset manually to provide curated bundles in the storefront.
            </p>
          ) : (
            configurationPresets.map((preset) => {
              const selectableGroups = groups.filter((group) => group.id && group.options.some((option) => option.id));
              const selectableAddOns = addOns.filter((addOn) => addOn.id);
              const selectablePlans = subscriptionPlans.filter((plan) => plan.id);
              const selectableFields = customFields.filter((field) => field.id);

              return (
                <div key={preset.key} className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                      <input
                        type="text"
                        value={preset.label}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            label: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Summary</span>
                      <input
                        type="text"
                        value={preset.summary}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            summary: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Display order</span>
                      <input
                        type="number"
                        value={preset.displayOrder}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            displayOrder:
                              Number.isFinite(Number(event.target.value)) && event.target.value !== ""
                                ? Number(event.target.value)
                                : 0,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Hero image URL</span>
                      <input
                        type="text"
                        value={preset.heroImageUrl}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            heroImageUrl: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Badge</span>
                      <input
                        type="text"
                        value={preset.badge}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            badge: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Price hint</span>
                      <input
                        type="text"
                        value={preset.priceHint}
                        onChange={(event) =>
                          updatePreset(preset.key, (current) => ({
                            ...current,
                            priceHint: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/40"
                      />
                    </label>
                  </div>

                <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.3em] text-white/40">
                  <button
                    type="button"
                    disabled={!selectionSnapshot}
                    className="rounded-full border border-white/20 px-3 py-1 text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applySnapshotToPreset(preset.key)}
                  >
                    Apply current preview
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-red-500/30 px-3 py-1 text-red-200 transition hover:border-red-400 hover:text-red-50"
                    onClick={() => removePreset(preset.key)}
                  >
                    Remove preset
                  </button>
                </div>
                {presetValidationMap[preset.key] && presetValidationMap[preset.key].length > 0 ? (
                  <ul className="space-y-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                    {presetValidationMap[preset.key].map((message, issueIndex) => (
                      <li key={`${preset.key}-issue-${issueIndex}`}>{message}</li>
                    ))}
                  </ul>
                ) : null}

                <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Option selections</p>
                    {selectableGroups.length === 0 ? (
                      <p className="text-xs text-white/50">
                        Publish option groups first—presets can only reference options with persisted identifiers.
                      </p>
                    ) : (
                      selectableGroups.map((group) => {
                        const groupId = group.id!;
                        const selectedOptions = preset.selection.optionSelections[groupId] ?? [];
                        return (
                          <div key={groupId} className="space-y-1">
                            <p className="text-sm font-semibold text-white">{group.name}</p>
                            <div className="flex flex-wrap gap-2">
                              {group.options
                                .filter((option) => option.id)
                                .map((option) => {
                                  const optionId = option.id!;
                                  const isSelected = selectedOptions.includes(optionId);
                                  return (
                                    <button
                                      key={optionId}
                                      type="button"
                                      onClick={() => togglePresetOption(preset.key, groupId, optionId)}
                                      className={`rounded-full border px-3 py-1 text-xs transition ${
                                        isSelected
                                          ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-100"
                                          : "border-white/20 text-white/70 hover:border-white/40 hover:text-white"
                                      }`}
                                    >
                                      {option.name}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">Add-ons</p>
                    {selectableAddOns.length === 0 ? (
                      <p className="text-xs text-white/50">No published add-ons available for presets.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectableAddOns.map((addOn) => {
                          const addOnId = addOn.id!;
                          const isSelected = preset.selection.addOnIds.includes(addOnId);
                          return (
                            <button
                              key={addOnId}
                              type="button"
                              onClick={() => togglePresetAddOn(preset.key, addOnId)}
                              className={`rounded-full border px-3 py-1 text-xs transition ${
                                isSelected
                                  ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-100"
                                  : "border-white/20 text-white/70 hover:border-white/40 hover:text-white"
                              }`}
                            >
                              {addOn.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm text-white/70">
                      <span className="text-xs uppercase tracking-[0.3em] text-white/40">Subscription plan</span>
                      <select
                        value={preset.selection.subscriptionPlanId ?? ""}
                        onChange={(event) =>
                          setPresetSubscriptionPlan(
                            preset.key,
                            event.target.value.length > 0 ? event.target.value : null,
                          )
                        }
                        className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/40"
                      >
                        <option value="">None</option>
                        {selectablePlans.map((plan) => (
                          <option key={plan.id} value={plan.id ?? ""}>
                            {plan.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">Custom field values</p>
                      {selectableFields.length === 0 ? (
                        <p className="text-xs text-white/50">No published custom fields yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {selectableFields.map((field) => (
                            <label key={field.id} className="flex flex-col gap-1 text-xs text-white/70">
                              {field.label}
                              <input
                                type="text"
                                value={preset.selection.customFieldValues[field.id!] ?? ""}
                                onChange={(event) => updatePresetCustomField(preset.key, field.id!, event.target.value)}
                                className="rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-white outline-none transition focus:border-white/40"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
          <h4 className="text-base font-semibold text-white">Preview checkout experience</h4>
          <ProductConfigurator
            basePrice={product.basePrice}
            currency={product.currency}
            optionGroups={configuratorGroups}
            addOns={configuratorAddOns}
            customFields={configuratorFields}
            subscriptionPlans={configuratorPlans}
            configurationPresets={previewConfigurationPresets}
            onChange={(config) => {
              setPreviewTotal(config.total);
              setSelectionSnapshot(config);
            }}
          />
        </div>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/70">
          <h4 className="text-base font-semibold text-white">Net price summary</h4>
          <p>
            Base price <span className="font-semibold text-white">{product.basePrice.toFixed(2)}</span> {product.currency}
          </p>
          <p>
            Preview total <span className="font-semibold text-white">{previewTotal.toFixed(2)}</span> {product.currency}
          </p>
          {selectionSnapshot ? (
            <div className="space-y-2 text-xs text-white/60">
              <p className="uppercase tracking-[0.3em] text-white/40">Selections</p>
              <pre className="rounded-xl border border-white/10 bg-black/60 p-3 text-white/70">
                {JSON.stringify(selectionSnapshot, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-white/60">Interact with the configurator to capture selection telemetry.</p>
          )}
        </div>
      </section>

      {state.error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {state.error}
        </div>
      ) : null}
      {state.success && !state.error ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          Configuration published successfully.
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.3em] text-white/40">
          Total nodes: {groups.length} groups · {addOns.length} add-ons · {customFields.length} fields · {subscriptionPlans.length} plans
        </div>
        <div className="flex flex-col items-end gap-2">
          {hasPresetValidationErrors ? (
            <p className="text-xs text-red-300">Fix preset validation errors above to enable publishing.</p>
          ) : null}
          <SubmitButton disabled={hasPresetValidationErrors} />
        </div>
      </div>
    </form>
  );
}
