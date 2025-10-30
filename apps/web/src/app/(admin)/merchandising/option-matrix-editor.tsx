"use client";

// meta: component: admin-option-matrix-editor

import { useCallback, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import {
  ProductConfigurator,
  type ConfiguratorAddOn,
  type ConfiguratorCustomField,
  type ConfiguratorOptionGroup,
  type ConfiguratorSelection,
  type SubscriptionPlan as ConfiguratorSubscriptionPlan,
} from "@/components/products/product-configurator";
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

type CustomFieldDraft = {
  key: string;
  id: string | null;
  label: string;
  fieldType: "text" | "url" | "number";
  placeholder: string;
  helpText: string;
  isRequired: boolean;
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

type OptionMatrixEditorProps = {
  product: ProductDetail;
  csrfToken: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
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

function toCustomFieldDrafts(fields: ProductDetail["customFields"]): CustomFieldDraft[] {
  return fields.map((field) => ({
    key: generateKey("field"),
    id: field.id,
    label: field.label,
    fieldType: field.fieldType,
    placeholder: field.placeholder ?? "",
    helpText: field.helpText ?? "",
    isRequired: field.isRequired,
    displayOrder: field.displayOrder ?? 0,
  }));
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
      options: group.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((option) => ({
          id: option.id ?? option.key,
          label: option.name,
          description: option.description || undefined,
          priceDelta: option.priceDelta,
          recommended: option.recommended,
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
    }));
}

function mapFieldsToConfigurator(fields: CustomFieldDraft[]): ConfiguratorCustomField[] {
  return fields
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((field) => ({
      id: field.id ?? field.key,
      label: field.label,
      type: field.fieldType,
      placeholder: field.placeholder || undefined,
      helpText: field.helpText || undefined,
      required: field.isRequired,
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
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(() =>
    toCustomFieldDrafts(product.customFields)
  );
  const [subscriptionPlans, setSubscriptionPlans] = useState<PlanDraft[]>(() =>
    toPlanDrafts(product.subscriptionPlans)
  );
  const [previewTotal, setPreviewTotal] = useState<number>(product.basePrice);
  const [selectionSnapshot, setSelectionSnapshot] = useState<ConfiguratorSelection | null>(null);

  const [state, action] = useFormState(updateProductConfigurationAction, initialActionState);

  const ensureDefaultPlan = useCallback((plans: PlanDraft[]): PlanDraft[] => {
    if (!plans.some((plan) => plan.isDefault) && plans.length > 0) {
      const [first, ...rest] = plans;
      return [{ ...first, isDefault: true }, ...rest];
    }
    return plans;
  }, []);

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
    setCustomFields((prev) => [
      ...prev,
      {
        key: generateKey("field"),
        id: null,
        label: "Custom field",
        fieldType: "text",
        placeholder: "",
        helpText: "",
        isRequired: false,
        displayOrder: prev.length,
      },
    ]);
  }, []);

  const updateCustomField = useCallback(
    (key: string, updater: (field: CustomFieldDraft) => CustomFieldDraft) => {
      setCustomFields((prev) => prev.map((field) => (field.key === key ? updater(field) : field)));
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
      customFields: customFields.map((field, index) => ({
        id: field.id,
        label: field.label.trim() || `Field ${index + 1}`,
        fieldType: field.fieldType,
        placeholder: field.placeholder.trim() || null,
        helpText: field.helpText.trim() || null,
        isRequired: field.isRequired,
        displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
      })),
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
    };
  }, [addOns, customFields, groups, subscriptionPlans]);

  const serializedConfiguration = useMemo(
    () => JSON.stringify(configurationPayload),
    [configurationPayload],
  );

  const configuratorGroups = useMemo(() => mapGroupsToConfigurator(groups), [groups]);
  const configuratorAddOns = useMemo(() => mapAddOnsToConfigurator(addOns), [addOns]);
  const configuratorFields = useMemo(() => mapFieldsToConfigurator(customFields), [customFields]);
  const configuratorPlans = useMemo(() => mapPlansToConfigurator(subscriptionPlans), [subscriptionPlans]);

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
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-white">Custom fields</h4>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            onClick={addCustomField}
          >
            Add field
          </button>
        </div>
        <div className="space-y-3">
          {customFields.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
              No custom fields configured.
            </p>
          ) : (
            customFields.map((field, index) => (
              <div key={field.key} className="grid gap-3 rounded-xl border border-white/10 bg-black/50 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
                <label className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/40">
                  <input
                    type="checkbox"
                    checked={field.isRequired}
                    onChange={(event) =>
                      updateCustomField(field.key, (current) => ({
                        ...current,
                        isRequired: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border border-white/30 bg-black/60"
                  />
                  Required
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
                <button
                  type="button"
                  onClick={() => removeCustomField(field.key)}
                  className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  Remove
                </button>
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
        <SubmitButton />
      </div>
    </form>
  );
}
