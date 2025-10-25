"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type PricingOption = {
  id: string;
  label: string;
  description?: string;
  priceDelta: number;
  recommended?: boolean;
};

export type ConfiguratorOptionGroup = {
  id: string;
  name: string;
  description?: string;
  type: "single" | "multiple";
  required?: boolean;
  options: PricingOption[];
};

export type ConfiguratorAddOn = {
  id: string;
  label: string;
  description?: string;
  priceDelta: number;
  recommended?: boolean;
};

export type ConfiguratorCustomField = {
  id: string;
  label: string;
  type: "text" | "url" | "number";
  placeholder?: string;
  required?: boolean;
  helpText?: string;
};

export type SubscriptionPlan = {
  id: string;
  label: string;
  description?: string;
  billingCycle: "one-time" | "monthly" | "quarterly" | "annual";
  priceMultiplier?: number;
  priceDelta?: number;
  default?: boolean;
};

type ProductConfiguratorProps = {
  basePrice: number;
  currency: string;
  optionGroups?: ConfiguratorOptionGroup[];
  addOns?: ConfiguratorAddOn[];
  customFields?: ConfiguratorCustomField[];
  subscriptionPlans?: SubscriptionPlan[];
  initialConfig?: ConfiguratorSelection;
  onChange?: (config: {
    total: number;
    selectedOptions: Record<string, string[]>;
    addOns: string[];
    subscriptionPlanId?: string;
    customFieldValues: Record<string, string>;
  }) => void;
  actions?: ReactNode;
};

export type ConfiguratorSelection = {
  selectedOptions: Record<string, string[]>;
  addOns: string[];
  subscriptionPlanId?: string;
  customFieldValues: Record<string, string>;
};

const sortStringArray = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));

const normalizeOptionRecord = (record: Record<string, string[]>): Record<string, string[]> => {
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(keys.map((key) => [key, sortStringArray(record[key])]));
};

const shallowEqualOptionRecords = (
  a: Record<string, string[]>,
  b: Record<string, string[]>
): boolean => {
  const normalizedA = normalizeOptionRecord(a);
  const normalizedB = normalizeOptionRecord(b);
  const keysA = Object.keys(normalizedA);
  const keysB = Object.keys(normalizedB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => {
    const optionsA = normalizedA[key] ?? [];
    const optionsB = normalizedB[key] ?? [];
    if (optionsA.length !== optionsB.length) {
      return false;
    }
    return optionsA.every((value, index) => value === optionsB[index]);
  });
};

const shallowEqualStringArrays = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = sortStringArray(a);
  const sortedB = sortStringArray(b);
  return sortedA.every((value, index) => value === sortedB[index]);
};

const shallowEqualStringRecord = (
  a: Record<string, string>,
  b: Record<string, string>
): boolean => {
  const entriesA = Object.entries(a).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  const entriesB = Object.entries(b).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  if (entriesA.length !== entriesB.length) {
    return false;
  }
  return entriesA.every(([key, value], index) => {
    const [otherKey, otherValue] = entriesB[index];
    return key === otherKey && value === otherValue;
  });
};

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ProductConfigurator({
  basePrice,
  currency,
  optionGroups = [],
  addOns = [],
  customFields = [],
  subscriptionPlans = [],
  initialConfig,
  onChange,
  actions,
}: ProductConfiguratorProps) {
  const initialSelections: Record<string, string[]> = useMemo(() => {
    const seeded: Record<string, string[]> = {};
    optionGroups.forEach((group) => {
      if (group.type === "single") {
        const defaultOption = group.options.find((option) => option.recommended) ?? group.options[0];
        if (defaultOption) {
          seeded[group.id] = [defaultOption.id];
        }
      } else {
        seeded[group.id] = [];
      }
    });
    return seeded;
  }, [optionGroups]);

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>(initialSelections);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(() => {
    const defaultPlan = subscriptionPlans.find((plan) => plan.default);
    return defaultPlan?.id ?? subscriptionPlans[0]?.id;
  });
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!initialConfig) {
      return;
    }

    const sanitizedOptions: Record<string, string[]> = {};
    optionGroups.forEach((group) => {
      const allowedOptionIds = new Set(group.options.map((option) => option.id));
      const incoming = initialConfig.selectedOptions?.[group.id] ?? [];
      const filtered = incoming.filter((id) => allowedOptionIds.has(id));
      if (group.type === "single") {
        const next = filtered.length > 0 ? [filtered[0]] : [];
        if (next.length === 0) {
          const fallback =
            group.options.find((option) => option.recommended) ?? group.options[0];
          sanitizedOptions[group.id] = fallback ? [fallback.id] : [];
        } else {
          sanitizedOptions[group.id] = next;
        }
      } else {
        sanitizedOptions[group.id] = filtered;
      }
    });

    const sanitizedAddOns = (initialConfig.addOns ?? []).filter((id) =>
      addOns.some((addOn) => addOn.id === id)
    );

    const eligiblePlans = subscriptionPlans.map((plan) => plan.id);
    const sanitizedPlanId = initialConfig.subscriptionPlanId && eligiblePlans.includes(initialConfig.subscriptionPlanId)
      ? initialConfig.subscriptionPlanId
      : selectedPlanId ?? subscriptionPlans.find((plan) => plan.default)?.id ?? subscriptionPlans[0]?.id;

    const sanitizedFields: Record<string, string> = {};
    customFields.forEach((field) => {
      const value = initialConfig.customFieldValues?.[field.id];
      if (typeof value === "string") {
        sanitizedFields[field.id] = value;
      }
    });

    setSelectedOptions((prev) =>
      shallowEqualOptionRecords(prev, sanitizedOptions) ? prev : sanitizedOptions
    );
    setSelectedAddOns((prev) =>
      shallowEqualStringArrays(prev, sanitizedAddOns) ? prev : sanitizedAddOns
    );
    setSelectedPlanId((prev) => (prev === sanitizedPlanId ? prev : sanitizedPlanId));
    setCustomFieldValues((prev) =>
      shallowEqualStringRecord(prev, sanitizedFields) ? prev : sanitizedFields
    );
  }, [
    addOns,
    customFields,
    initialConfig,
    optionGroups,
    selectedPlanId,
    subscriptionPlans,
  ]);

  const total = useMemo(() => {
    let price = basePrice;

    optionGroups.forEach((group) => {
      const selections = selectedOptions[group.id] ?? [];
      selections.forEach((id) => {
        const option = group.options.find((item) => item.id === id);
        if (option) {
          price += option.priceDelta;
        }
      });
    });

    selectedAddOns.forEach((id) => {
      const addOn = addOns.find((item) => item.id === id);
      if (addOn) {
        price += addOn.priceDelta;
      }
    });

    if (selectedPlanId) {
      const plan = subscriptionPlans.find((item) => item.id === selectedPlanId);
      if (plan) {
        if (plan.priceDelta) {
          price += plan.priceDelta;
        }
        if (plan.priceMultiplier) {
          price = Math.round(price * plan.priceMultiplier);
        }
      }
    }

    return price;
  }, [addOns, basePrice, optionGroups, selectedAddOns, selectedOptions, selectedPlanId, subscriptionPlans]);

  useEffect(() => {
    if (!onChange) {
      return;
    }
    onChange({
      total,
      selectedOptions,
      addOns: selectedAddOns,
      subscriptionPlanId: selectedPlanId,
      customFieldValues,
    });
  }, [addOns, customFieldValues, onChange, selectedAddOns, selectedOptions, selectedPlanId, total]);

  const handleSelectSingle = (groupId: string, optionId: string) => {
    setSelectedOptions((prev) => {
      return { ...prev, [groupId]: [optionId] };
    });
  };

  const handleToggleMulti = (groupId: string, optionId: string) => {
    setSelectedOptions((prev) => {
      const current = prev[groupId] ?? [];
      const exists = current.includes(optionId);
      const nextSelections = exists ? current.filter((id) => id !== optionId) : [...current, optionId];
      return { ...prev, [groupId]: nextSelections };
    });
  };

  // Event handlers for checkbox inputs
  const handleCheckboxChange = (groupId: string, optionId: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const group = optionGroups.find(g => g.id === groupId);
      if (group?.type === "single") {
        handleSelectSingle(groupId, optionId);
      } else {
        handleToggleMulti(groupId, optionId);
      }
    } else {
      handleToggleMulti(groupId, optionId);
    }
  };

  const handleToggleAddOn = (addOnId: string) => {
    setSelectedAddOns((prev) => {
      const exists = prev.includes(addOnId);
      return exists ? prev.filter((id) => id !== addOnId) : [...prev, addOnId];
    });
  };

  const handlePlanChange = (planId: string) => {
    setSelectedPlanId(planId);
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    setCustomFieldValues((prev) => {
      return { ...prev, [fieldId]: value };
    });
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur" data-testid="product-configurator">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Configure your campaign</h2>
          <p className="mt-2 text-sm text-white/60">Adjust campaign scope, add-ons, and billing cadence.</p>
        </div>
        <div className="rounded-2xl bg-white px-5 py-2 text-right text-sm font-semibold text-black shadow-lg">
          <span className="block text-xs uppercase tracking-wide text-black/60">Total investment</span>
          <span className="text-xl" data-testid="total-price">{formatCurrency(total, currency)}</span>
        </div>
      </div>

      {subscriptionPlans.length > 0 ? (
        <div className="mt-8 space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">Billing cadence</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {subscriptionPlans.map((plan) => {
              const isActive = plan.id === selectedPlanId;
              return (
                <label
                  key={plan.id}
                  className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                    isActive ? "border-white/70 bg-white/10" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="subscription-plan"
                    value={plan.id}
                    checked={isActive}
                    onChange={() => handlePlanChange(plan.id)}
                    className="sr-only"
                    data-testid={`plan-${plan.id}`}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{plan.label}</span>
                    {plan.priceMultiplier ? (
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                        x{plan.priceMultiplier.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                  {plan.description ? <p className="mt-2 text-sm text-white/60">{plan.description}</p> : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {optionGroups.length > 0 ? (
        <div className="mt-10 space-y-8">
          {optionGroups.map((group) => (
            <div key={group.id} data-testid="option-group">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{group.name}</h3>
                  {group.description ? <p className="text-sm text-white/60">{group.description}</p> : null}
                </div>
                {group.required ? (
                  <span className="text-xs uppercase tracking-wide text-white/40">Required</span>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {group.options.map((option) => {
                  const selection = selectedOptions[group.id] ?? [];
                  const isSelected = selection.includes(option.id);
                  const handler =
                    group.type === "single"
                      ? () => handleSelectSingle(group.id, option.id)
                      : () => handleToggleMulti(group.id, option.id);
                  return (
                    <label
                      key={option.id}
                      className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                        isSelected ? "border-white/70 bg-white/10" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={handleCheckboxChange(group.id, option.id)}
                        className="sr-only"
                        data-testid={`option-${option.id}`}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-white">{option.label}</span>
                        <span className="text-sm text-white/70">
                          {option.priceDelta >= 0 ? "+" : "-"}
                          {formatCurrency(Math.abs(option.priceDelta), currency)}
                        </span>
                      </div>
                      {option.description ? (
                        <p className="mt-2 text-sm text-white/60">{option.description}</p>
                      ) : null}
                      {option.recommended ? (
                        <span className="mt-3 inline-flex rounded-full bg-white/10 px-2 py-1 text-xs uppercase tracking-wide text-white/60">
                          Recommended
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {addOns.length > 0 ? (
        <div className="mt-10">
          <h3 className="text-lg font-semibold text-white">Enhance your campaign</h3>
          <p className="text-sm text-white/60">Optional add-ons to accelerate growth.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {addOns.map((addOn) => {
              const selected = selectedAddOns.includes(addOn.id);
              return (
                <label
                  key={addOn.id}
                  className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                    selected ? "border-white/70 bg-white/10" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => handleToggleAddOn(addOn.id)}
                    className="sr-only"
                    data-testid={`addon-${addOn.id}`}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{addOn.label}</span>
                    <span className="text-sm text-white/70">
                      +{formatCurrency(Math.abs(addOn.priceDelta), currency)}
                    </span>
                  </div>
                  {addOn.description ? (
                    <p className="mt-2 text-sm text-white/60">{addOn.description}</p>
                  ) : null}
                  {addOn.recommended ? (
                    <span className="mt-3 inline-flex rounded-full bg-white/10 px-2 py-1 text-xs uppercase tracking-wide text-white/60">
                      High impact
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {customFields.length > 0 ? (
        <div className="mt-10 space-y-4">
          <h3 className="text-lg font-semibold text-white">Campaign inputs</h3>
          <p className="text-sm text-white/60">
            Provide the information we need to kick off fulfillment. These details are encrypted in transit and
            stored securely.
          </p>
          <div className="grid gap-4">
            {customFields.map((field) => (
              <div key={field.id} className="space-y-2">
                <label className="flex items-center justify-between text-sm font-medium text-white" htmlFor={`field-${field.id}`}>
                  <span>{field.label}</span>
                  {field.required ? (
                    <span className="text-xs uppercase tracking-wide text-white/40">Required</span>
                  ) : null}
                </label>
                <input
                  id={`field-${field.id}`}
                  type={field.type}
                  value={customFieldValues[field.id] ?? ""}
                  onChange={(event) => handleFieldChange(field.id, event.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white outline-none transition focus:border-white/40"
                />
                {field.helpText ? <p className="text-xs text-white/50">{field.helpText}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-12 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-white/40">Estimated investment</p>
          <p className="text-2xl font-semibold text-white">{formatCurrency(total, currency)}</p>
          <p className="text-xs text-white/60">
            Final amount confirmed during secure checkout. Taxes calculated based on billing details.
          </p>
        </div>
        {actions ? <div className="flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
      </div>
    </section>
  );
}
