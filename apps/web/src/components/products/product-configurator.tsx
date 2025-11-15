"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  calculateAddOnDelta,
  calculateOptionDelta,
  formatAddOnPreview,
  getAddOnPricingInfo
} from "@/lib/product-pricing";
import type { AddOnPricingInfo } from "@/lib/product-pricing";
import { FX_RATE_TABLE, type FxRateTable } from "@/lib/fx-rates";
import {
  describeGuardrails,
  evaluateMargin,
  estimateProviderCost,
  type MarginStatus
} from "@/lib/provider-service-insights";
import type {
  CustomFieldVisibilityCondition,
  ProductAddOnMetadata,
  ProductAddOnPricingSnapshot,
  ProductCustomFieldRegexRule,
  ProductOptionCalculatorMetadata,
  ProductOptionMediaAttachment,
  ProductOptionMetadata,
  ProductOptionStructuredPricing,
} from "@/types/product";
import type { ServiceOverrideRule } from "@/types/product";
import type { ProviderServiceMetadata, ProviderServiceGuardrails } from "@smplat/types";

type PricingOption = {
  id: string;
  label: string;
  description?: string;
  priceDelta: number;
  recommended?: boolean;
  structuredPricing?: ProductOptionStructuredPricing | null;
  media?: ProductOptionMediaAttachment[] | null;
  metadata?: ProductOptionMetadata | null;
};

export type ConfiguratorOptionGroup = {
  id: string;
  name: string;
  description?: string;
  type: "single" | "multiple";
  required?: boolean;
  metadata?: Record<string, unknown> | null;
  options: PricingOption[];
};

export type ConfiguratorAddOn = {
  id: string;
  label: string;
  description?: string;
  priceDelta: number;
  recommended?: boolean;
  metadata?: ProductAddOnMetadata | null;
  metadataJson?: ProductAddOnMetadata | null;
  pricing?: ProductAddOnPricingSnapshot | null;
  computedDelta?: number;
  percentageMultiplier?: number | null;
};

export type ConfiguratorCustomField = {
  id: string;
  label: string;
  type: "text" | "url" | "number";
  placeholder?: string;
  required?: boolean;
  helpText?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    pattern?: string;
    regex?: ProductCustomFieldRegexRule | null;
    disallowWhitespace?: boolean;
    numericStep?: number;
    allowedValues?: string[];
  };
  passthrough?: {
    fulfillment?: boolean;
  };
  defaultValue?: string | null;
  conditional?: {
    mode: "all" | "any";
    conditions: CustomFieldVisibilityCondition[];
  };
  sampleValues?: string[];
};

export type SubscriptionPlan = {
  id: string;
  label: string;
  description?: string;
  billingCycle: "one-time" | "monthly" | "quarterly" | "annual";
  priceMultiplier?: number;
  priceDelta?: number;
  default?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type ConfiguratorPresetSelection = {
  optionSelections: Record<string, string[]>;
  addOnIds: string[];
  subscriptionPlanId?: string | null;
  customFieldValues: Record<string, string>;
};

export type ConfiguratorPreset = {
  id: string;
  label: string;
  summary?: string | null;
  heroImageUrl?: string | null;
  badge?: string | null;
  priceHint?: string | null;
  displayOrder?: number | null;
  selection: ConfiguratorPresetSelection;
};

type ProductConfiguratorProps = {
  basePrice: number;
  currency: string;
  optionGroups?: ConfiguratorOptionGroup[];
  addOns?: ConfiguratorAddOn[];
  customFields?: ConfiguratorCustomField[];
  subscriptionPlans?: SubscriptionPlan[];
  configurationPresets?: ConfiguratorPreset[];
  initialConfig?: ConfiguratorSelection;
  onChange?: (config: {
    total: number;
    selectedOptions: Record<string, string[]>;
    addOns: string[];
    subscriptionPlanId?: string;
    customFieldValues: Record<string, string>;
  }) => void;
  actions?: ReactNode;
  activeChannel?: string;
  fxRates?: FxRateTable;
};

export type ConfiguratorSelection = {
  selectedOptions: Record<string, string[]>;
  addOns: string[];
  subscriptionPlanId?: string;
  customFieldValues: Record<string, string>;
  presetId?: string | null;
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

const isCalculatorExpressionSafe = (expression: string): boolean => {
  const sanitized = expression
    .replace(/\bamount\b/gi, "")
    .replace(/\bdays\b/gi, "")
    .replace(/[0-9+\-*/().\s]/g, "");
  return sanitized.trim().length === 0;
};

const evaluateCalculatorPreview = (
  calculator: ProductOptionCalculatorMetadata | null | undefined
): number | null => {
  if (!calculator || typeof calculator.expression !== "string") {
    return null;
  }
  const expression = calculator.expression.trim();
  if (!expression || !isCalculatorExpressionSafe(expression)) {
    return null;
  }

  try {
    const fn = Function("amount", "days", `return ${expression};`) as (
      amount: number,
      days: number
    ) => unknown;
    const amount =
      typeof calculator.sampleAmount === "number" && Number.isFinite(calculator.sampleAmount)
        ? calculator.sampleAmount
        : 0;
    const days =
      typeof calculator.sampleDays === "number" && Number.isFinite(calculator.sampleDays)
        ? calculator.sampleDays
        : 0;
    const result = fn(amount, days);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

type MarginInsight = {
  status: MarginStatus;
  marginValue: number | null;
  marginPercent: number | null;
  providerCostOriginal: number | null;
  providerCostConverted: number | null;
  providerCurrency: string;
  guardrailSummary?: string;
  requiresConversion: boolean;
};

type RuleConflictInsight = {
  status: "unsupported_channel" | "ambiguous";
  messages: string[];
};

type ServiceDescriptorPayload = {
  metadata?: ProviderServiceMetadata | null;
  defaultCurrency?: string | null;
};

export function buildAddOnMarginInsight(params: {
  addOn: ConfiguratorAddOn;
  info: AddOnPricingInfo;
  productCurrency: string;
  subtotalBeforeAddOns: number;
  fxRates?: FxRateTable;
}): MarginInsight | null {
  if (params.info.mode !== "serviceOverride") {
    return null;
  }
  const descriptor = parseServiceDescriptor(params.info.serviceDescriptor);
  const metadata = descriptor.metadata;
  const mergedGuardrails = mergeGuardrails(metadata?.guardrails ?? null, params.info.marginTarget);
  const guardrails = normalizeGuardrailsCurrency(mergedGuardrails, params.productCurrency, params.fxRates);

  const providerCurrency = selectProviderCurrency({
    info: params.info,
    metadata,
    descriptorCurrency: descriptor.defaultCurrency,
    productCurrency: params.productCurrency,
  });
  const previewQuantity =
    params.info.previewQuantity ??
    metadata?.defaultInputs?.quantity ??
    metadata?.defaultInputs?.durationDays ??
    1;
  const providerCostOriginal =
    typeof params.info.providerCostAmount === "number" && Number.isFinite(params.info.providerCostAmount)
      ? params.info.providerCostAmount
      : estimateProviderCost(metadata?.costModel ?? null, previewQuantity) ?? null;
  const rawDelta = calculateAddOnDelta(params.addOn, params.subtotalBeforeAddOns);
  const customerDelta = Number.isFinite(rawDelta) ? rawDelta : null;

  const normalizedProviderCurrency = providerCurrency.toUpperCase();
  const normalizedProductCurrency = params.productCurrency.toUpperCase();
  let requiresConversion = normalizedProviderCurrency !== normalizedProductCurrency;
  let providerCostForMargin = providerCostOriginal;
  let providerCostConverted: number | null = null;

  if (requiresConversion) {
    const converted = convertAmount(
      providerCostOriginal,
      normalizedProviderCurrency,
      normalizedProductCurrency,
      params.fxRates,
    );
    if (converted != null) {
      providerCostForMargin = converted;
      providerCostConverted = converted;
      requiresConversion = false;
    }
  } else {
    providerCostConverted = providerCostOriginal;
  }

  const evaluation = !requiresConversion
    ? evaluateMargin(guardrails ?? null, providerCostForMargin, customerDelta)
    : { status: "idle" as MarginStatus, marginValue: null, marginPercent: null };
  const guardrailSummary = guardrails
    ? describeGuardrails(guardrails, params.productCurrency)[0] ?? undefined
    : undefined;

  return {
    status: evaluation.status,
    marginValue: evaluation.marginValue,
    marginPercent: evaluation.marginPercent,
    providerCostOriginal,
    providerCostConverted,
    providerCurrency: normalizedProviderCurrency,
    guardrailSummary,
    requiresConversion,
  };
}

function parseServiceDescriptor(descriptor: AddOnPricingInfo["serviceDescriptor"]): ServiceDescriptorPayload {
  if (!descriptor || typeof descriptor !== "object") {
    return { metadata: null, defaultCurrency: null };
  }
  const metadata =
    "metadata" in descriptor && descriptor.metadata && typeof descriptor.metadata === "object"
      ? (descriptor.metadata as ProviderServiceMetadata)
      : null;
  const defaultCurrency =
    "defaultCurrency" in descriptor && typeof descriptor.defaultCurrency === "string"
      ? descriptor.defaultCurrency
      : null;
  return { metadata, defaultCurrency };
}

function mergeGuardrails(
  base: ProviderServiceGuardrails | null,
  marginTarget: number | null | undefined,
): ProviderServiceGuardrails | null {
  if (!base && marginTarget == null) {
    return null;
  }
  const merged: ProviderServiceGuardrails = { ...(base ?? {}) };
  if (marginTarget != null) {
    merged.minimumMarginPercent = marginTarget;
  }
  return merged;
}

function selectProviderCurrency(params: {
  info: AddOnPricingInfo;
  metadata: ProviderServiceMetadata | null | undefined;
  descriptorCurrency?: string | null;
  productCurrency: string;
}): string {
  const costModelCurrency =
    params.metadata?.costModel &&
    typeof (params.metadata.costModel as ProviderServiceCostModelLike).currency === "string"
      ? (params.metadata.costModel as ProviderServiceCostModelLike).currency
      : undefined;
  const candidates = [
    params.info.providerCostCurrency,
    costModelCurrency,
    params.metadata?.guardrails?.currency,
    params.descriptorCurrency,
    params.productCurrency,
  ];
  const resolved = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return (resolved ?? params.productCurrency).toUpperCase();
}

type ProviderServiceCostModelLike = {
  currency?: string | null;
};

function normalizeGuardrailsCurrency(
  guardrails: ProviderServiceGuardrails | null,
  productCurrency: string,
  fxRates?: FxRateTable,
): ProviderServiceGuardrails | null {
  if (!guardrails) {
    return null;
  }
  const normalizedCurrency = guardrails.currency?.toUpperCase() ?? null;
  if (!normalizedCurrency || normalizedCurrency === productCurrency) {
    return guardrails;
  }
  if (guardrails.minimumMarginAbsolute == null) {
    return guardrails;
  }
  const converted = convertAmount(guardrails.minimumMarginAbsolute, normalizedCurrency, productCurrency, fxRates);
  if (converted == null) {
    return guardrails;
  }
  return {
    ...guardrails,
    minimumMarginAbsolute: converted,
    currency: productCurrency,
  };
}

function convertAmount(
  amount: number | null | undefined,
  fromCurrency: string,
  toCurrency: string,
  fxRates?: FxRateTable,
): number | null {
  if (amount == null || Number.isNaN(amount)) {
    return null;
  }
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) {
    return amount;
  }
  const rate = fxRates?.[from]?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return amount * rate;
}

function resolveMarginBadgeStyle(status: MarginStatus) {
  switch (status) {
    case "pass":
      return { badge: "border-emerald-300/60 text-emerald-200", label: "Healthy" };
    case "warn":
      return { badge: "border-amber-300/60 text-amber-200", label: "Warning" };
    case "fail":
      return { badge: "border-rose-400/60 text-rose-100", label: "Guardrail breach" };
    default:
      return { badge: "border-white/20 text-white/60", label: "Pending" };
  }
}

export function formatMarginLabel(insight: MarginInsight, currency: string): string {
  if (insight.requiresConversion) {
    return "FX pending";
  }
  if (insight.marginValue == null || insight.marginPercent == null) {
    return "Pending input";
  }
  const percent = `${insight.marginPercent.toFixed(1)}%`;
  return `${formatCurrency(insight.marginValue, currency)} (${percent})`;
}

export function formatProviderCostSummary(insight: MarginInsight, productCurrency: string): string | null {
  if (insight.providerCostOriginal == null) {
    return null;
  }
  const base = formatCurrency(insight.providerCostOriginal, insight.providerCurrency);
  if (
    insight.providerCurrency !== productCurrency &&
    insight.providerCostConverted != null
  ) {
    return `${base} (≈ ${formatCurrency(insight.providerCostConverted, productCurrency)})`;
  }
  return base;
}

export function analyzeServiceRuleConflicts(
  rules: ServiceOverrideRule[] | null | undefined,
  channel?: string,
): RuleConflictInsight | null {
  if (!Array.isArray(rules) || rules.length === 0 || !channel) {
    return null;
  }
  const normalizedChannel = channel.toLowerCase();
  const hasChannelConditions = rules.some((rule) =>
    (rule.conditions ?? []).some((condition) => condition.kind === "channel"),
  );
  const matchingRules = rules.filter((rule) => ruleSupportsChannel(rule, normalizedChannel));

  if (hasChannelConditions && matchingRules.length === 0) {
    return {
      status: "unsupported_channel",
      messages: [`Not available for ${channel.toUpperCase()} channel`],
    };
  }
  if (matchingRules.length <= 1) {
    return null;
  }
  const signatures = new Set(
    matchingRules.map(
      (rule) => `${rule.overrides?.providerId ?? "default"}|${rule.overrides?.serviceId ?? "default"}`,
    ),
  );
  if (signatures.size > 1) {
    return {
      status: "ambiguous",
      messages: ["Multiple rules map this channel to different providers. Operator review recommended."],
    };
  }
  return null;
}

function ruleSupportsChannel(rule: ServiceOverrideRule, normalizedChannel: string): boolean {
  const channelConditions = (rule.conditions ?? []).filter((condition) => condition.kind === "channel");
  if (channelConditions.length === 0) {
    return true;
  }
  return channelConditions.some((condition) =>
    (condition.channels ?? []).some((channel) => channel.toLowerCase() === normalizedChannel),
  );
}

function formatCurrencyDelta(amount: number, currency: string): string {
  if (amount === 0) {
    return formatCurrency(0, currency);
  }
  const formatted = formatCurrency(Math.abs(amount), currency);
  return amount > 0 ? `+${formatted}` : `-${formatted}`;
}

export function ProductConfigurator({
  basePrice,
  currency,
  optionGroups = [],
  addOns = [],
  customFields = [],
  subscriptionPlans = [],
  configurationPresets = [],
  initialConfig,
  onChange,
  actions,
  activeChannel,
  fxRates = FX_RATE_TABLE,
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activePresetId, setActivePresetId] = useState<string | null>(
    initialConfig?.presetId ?? null,
  );

  const sortedPresets = useMemo(() => {
    return configurationPresets
      .slice()
      .sort(
        (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
      );
  }, [configurationPresets]);

  const optionKeyToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    optionGroups.forEach((group) => {
      group.options.forEach((option) => {
        const editorKey = option.metadata && typeof option.metadata === "object"
          ? (option.metadata.editorKey as string | undefined)
          : undefined;
        if (typeof editorKey === "string" && editorKey.length > 0) {
          map.set(editorKey, option.id);
        }
      });
    });
    return map;
  }, [optionGroups]);

  const groupKeyToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    optionGroups.forEach((group) => {
      const metadata = group.metadata;
      const editorKey =
        metadata && typeof metadata === "object"
          ? ((metadata as Record<string, unknown>).editorKey as string | undefined)
          : undefined;
      if (typeof editorKey === "string" && editorKey.length > 0) {
        map.set(editorKey, group.id);
      }
    });
    return map;
  }, [optionGroups]);

  const addOnKeyToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    addOns.forEach((addOn) => {
      const editorKey =
        addOn.metadata && typeof addOn.metadata === "object"
          ? (addOn.metadata.editorKey as string | undefined)
          : undefined;
      if (typeof editorKey === "string" && editorKey.length > 0) {
        map.set(editorKey, addOn.id);
      }
    });
    return map;
  }, [addOns]);

  const planKeyToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    subscriptionPlans.forEach((plan) => {
      const candidate = plan as SubscriptionPlan & { metadata?: Record<string, unknown> | null };
      const editorKey =
        candidate.metadata && typeof candidate.metadata === "object"
          ? (candidate.metadata.editorKey as string | undefined)
          : undefined;
      if (typeof editorKey === "string" && editorKey.length > 0) {
        map.set(editorKey, plan.id);
      }
    });
    return map;
  }, [subscriptionPlans]);

  const sanitizePresetApplication = useCallback(
    (preset: ConfiguratorPreset) => {
      const optionSelections: Record<string, string[]> = {};
      optionGroups.forEach((group) => {
        const allowed = new Set(group.options.map((option) => option.id));
        const incoming = preset.selection.optionSelections[group.id] ?? [];
        const filtered = incoming.filter((id) => allowed.has(id));
        if (group.type === "single") {
          const fallback =
            filtered[0] ??
            (group.options.find((option) => option.recommended) ?? group.options[0])?.id;
          optionSelections[group.id] = fallback ? [fallback] : [];
        } else {
          optionSelections[group.id] = filtered;
        }
      });

      const addOnIds = preset.selection.addOnIds.filter((id) =>
        addOns.some((addOn) => addOn.id === id),
      );

      const subscriptionPlanId =
        preset.selection.subscriptionPlanId &&
        subscriptionPlans.some((plan) => plan.id === preset.selection.subscriptionPlanId)
          ? preset.selection.subscriptionPlanId
          : subscriptionPlans.find((plan) => plan.default)?.id ?? subscriptionPlans[0]?.id ?? null;

      const fieldValues: Record<string, string> = {};
      customFields.forEach((field) => {
        const incomingValue = preset.selection.customFieldValues[field.id];
        if (typeof incomingValue === "string" && incomingValue.length > 0) {
          fieldValues[field.id] = incomingValue;
        } else if (typeof field.defaultValue === "string" && field.defaultValue.length > 0) {
          fieldValues[field.id] = field.defaultValue;
        }
      });

      return {
        options: optionSelections,
        addOns: addOnIds,
        planId: subscriptionPlanId ?? undefined,
        fields: fieldValues,
      };
    },
    [addOns, customFields, optionGroups, subscriptionPlans],
  );

  const isFieldVisible = useCallback(
    (field: ConfiguratorCustomField): boolean => {
      const conditional = field.conditional;
      if (!conditional || conditional.conditions.length === 0) {
        return true;
      }

      const evaluate = (condition: CustomFieldVisibilityCondition): boolean => {
        switch (condition.kind) {
          case "option": {
            const optionIds = new Set<string>();
            if (condition.optionId) {
              optionIds.add(condition.optionId);
            }
            if (condition.optionKey) {
              const mapped = optionKeyToIdMap.get(condition.optionKey);
              if (mapped) {
                optionIds.add(mapped);
              }
            }
            if (optionIds.size === 0) {
              return false;
            }

            const groupCandidates: string[] = [];
            if (condition.groupId) {
              groupCandidates.push(condition.groupId);
            }
            if (condition.groupKey) {
              const mappedGroup = groupKeyToIdMap.get(condition.groupKey);
              if (mappedGroup) {
                groupCandidates.push(mappedGroup);
              }
            }

            if (groupCandidates.length > 0) {
              return groupCandidates.some((groupId) =>
                (selectedOptions[groupId] ?? []).some((id) => optionIds.has(id))
              );
            }

            return Object.values(selectedOptions).some((ids) =>
              ids.some((id) => optionIds.has(id))
            );
          }
          case "addOn": {
            const addOnIds = new Set<string>();
            if (condition.addOnId) {
              addOnIds.add(condition.addOnId);
            }
            if (condition.addOnKey) {
              const mapped = addOnKeyToIdMap.get(condition.addOnKey);
              if (mapped) {
                addOnIds.add(mapped);
              }
            }
            if (addOnIds.size === 0) {
              return false;
            }
            return selectedAddOns.some((id) => addOnIds.has(id));
          }
          case "subscriptionPlan": {
            if (condition.planId) {
              return selectedPlanId === condition.planId;
            }
            if (condition.planKey) {
              const mapped = planKeyToIdMap.get(condition.planKey);
              if (mapped) {
                return selectedPlanId === mapped;
              }
              // Without metadata we optimistically treat unknown keys as satisfied.
              return true;
            }
            return true;
          }
          case "channel": {
            if (!condition.channel) {
              return true;
            }
            if (!activeChannel) {
              return true;
            }
            return activeChannel === condition.channel;
          }
          default:
            return true;
        }
      };

      const results = conditional.conditions.map(evaluate);
      return conditional.mode === "all" ? results.every(Boolean) : results.some(Boolean);
    },
    [
      activeChannel,
      addOnKeyToIdMap,
      groupKeyToIdMap,
      optionKeyToIdMap,
      planKeyToIdMap,
      selectedAddOns,
      selectedOptions,
      selectedPlanId,
    ],
  );

  const validateFieldValue = useCallback(
    (field: ConfiguratorCustomField, rawValue: string): string | null => {
      const value = rawValue ?? "";
      const trimmed = field.type === "number" ? value.trim() : value.trim();

      if ((field.required ?? false) && trimmed.length === 0) {
        return `${field.label} is required.`;
      }

      if (trimmed.length === 0) {
        return null;
      }

      const rules = field.validation;
      if (rules?.minLength != null && trimmed.length < rules.minLength) {
        return `${field.label} must be at least ${rules.minLength} characters.`;
      }
      if (rules?.maxLength != null && trimmed.length > rules.maxLength) {
        return `${field.label} must be at most ${rules.maxLength} characters.`;
      }
      if (rules?.disallowWhitespace && /\s/.test(value)) {
        return `${field.label} cannot include whitespace.`;
      }
      if (rules?.pattern) {
        try {
          const regex = new RegExp(rules.pattern);
          if (!regex.test(value)) {
            return `${field.label} must match the required format.`;
          }
        } catch {
          // ignore malformed regex in runtime validation; treat as pass
        }
      }
      if (rules?.allowedValues && rules.allowedValues.length > 0) {
        const match = rules.allowedValues.some((allowed) => allowed === trimmed);
        if (!match) {
          return `${field.label} must match one of: ${rules.allowedValues.join(", ")}.`;
        }
      }
      if (field.type === "number") {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return `${field.label} must be a valid number.`;
        }
        if (rules?.minValue != null && numeric < rules.minValue) {
          return `${field.label} must be at least ${rules.minValue}.`;
        }
        if (rules?.maxValue != null && numeric > rules.maxValue) {
          return `${field.label} must be at most ${rules.maxValue}.`;
        }
        if (rules?.numericStep && rules.numericStep > 0) {
          const remainder = Math.abs(numeric % rules.numericStep);
          const epsilon = 1e-9;
          const aligned = remainder < epsilon || Math.abs(remainder - rules.numericStep) < epsilon;
          if (!aligned) {
            return `${field.label} must increase in increments of ${rules.numericStep}.`;
          }
        }
      }
      return null;
    },
    []
  );

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
    const initialErrors: Record<string, string> = {};
    customFields.forEach((field) => {
      const value = initialConfig.customFieldValues?.[field.id];
      const defaultValue = field.defaultValue ?? "";
      const resolvedValue =
        typeof value === "string"
          ? value
          : defaultValue != null && defaultValue.length > 0
            ? defaultValue
            : "";
      if (resolvedValue.length > 0) {
        sanitizedFields[field.id] = resolvedValue;
      }
      const error = validateFieldValue(field, resolvedValue);
      if (error) {
        initialErrors[field.id] = error;
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
    setFieldErrors(initialErrors);
  }, [
    addOns,
    customFields,
    initialConfig,
    optionGroups,
    selectedPlanId,
    subscriptionPlans,
    validateFieldValue,
  ]);

  useEffect(() => {
    setCustomFieldValues((previous) => {
      const next: Record<string, string> = { ...previous };
      let changed = false;

      customFields.forEach((field) => {
        const visible = isFieldVisible(field);
        if (!visible) {
          if (next[field.id] !== undefined) {
            delete next[field.id];
            changed = true;
          }
          return;
        }

        if ((next[field.id] == null || next[field.id] === "") && field.defaultValue && field.defaultValue.length > 0) {
          next[field.id] = field.defaultValue;
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [customFields, isFieldVisible]);

  useEffect(() => {
    const nextErrors: Record<string, string> = {};
    customFields.forEach((field) => {
      if (!isFieldVisible(field)) {
        return;
      }
      const value = customFieldValues[field.id] ?? field.defaultValue ?? "";
      const error = validateFieldValue(field, value);
      if (error) {
        nextErrors[field.id] = error;
      }
    });
    setFieldErrors((previous) =>
      shallowEqualStringRecord(previous, nextErrors) ? previous : nextErrors
    );
  }, [customFields, customFieldValues, isFieldVisible, validateFieldValue]);

  useEffect(() => {
    if (sortedPresets.length === 0) {
      if (activePresetId !== null) {
        setActivePresetId(null);
      }
      return;
    }
    const matched = sortedPresets.find((preset) => {
      const normalized = sanitizePresetApplication(preset);
      return (
        shallowEqualOptionRecords(selectedOptions, normalized.options) &&
        shallowEqualStringArrays(selectedAddOns, normalized.addOns) &&
        ((selectedPlanId ?? null) === (normalized.planId ?? null)) &&
        shallowEqualStringRecord(customFieldValues, normalized.fields)
      );
    });
    const nextId = matched ? matched.id : null;
    if (nextId !== activePresetId) {
      setActivePresetId(nextId);
    }
  }, [
    activePresetId,
    customFieldValues,
    sanitizePresetApplication,
    selectedAddOns,
    selectedOptions,
    selectedPlanId,
    sortedPresets,
  ]);

  const subtotalBeforeAddOns = useMemo(() => {
    let price = basePrice;

    optionGroups.forEach((group) => {
      const selections = selectedOptions[group.id] ?? [];
      selections.forEach((id) => {
        const option = group.options.find((item) => item.id === id);
        if (!option) {
          return;
        }
        const optionPayload = {
          priceDelta: option.priceDelta,
          metadataJson: option.structuredPricing
            ? { structuredPricing: option.structuredPricing }
            : undefined,
          structuredPricing: option.structuredPricing ?? undefined,
        };
        price += calculateOptionDelta(optionPayload, basePrice, group.type);
      });
    });

    return price;
  }, [basePrice, optionGroups, selectedOptions]);

  const total = useMemo(() => {
    let price = basePrice;

    optionGroups.forEach((group) => {
      const selections = selectedOptions[group.id] ?? [];
      selections.forEach((id) => {
        const option = group.options.find((item) => item.id === id);
        if (!option) {
          return;
        }
        const optionPayload = {
          priceDelta: option.priceDelta,
          metadataJson: option.structuredPricing
            ? { structuredPricing: option.structuredPricing }
            : undefined,
          structuredPricing: option.structuredPricing ?? undefined,
        };
        price += calculateOptionDelta(optionPayload, basePrice, group.type);
      });
    });

    selectedAddOns.forEach((id) => {
      const addOn = addOns.find((item) => item.id === id);
      if (addOn) {
        const delta = calculateAddOnDelta(addOn, price);
        price += delta;
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
    const visibleFieldValues = Object.fromEntries(
      customFields
        .filter((field) => isFieldVisible(field))
        .map((field) => [field.id, customFieldValues[field.id] ?? ""]),
    );

    onChange({
      total,
      selectedOptions,
      addOns: selectedAddOns,
      subscriptionPlanId: selectedPlanId,
      customFieldValues: visibleFieldValues,
      presetId: activePresetId ?? null,
    });
  }, [
    activePresetId,
    customFieldValues,
    customFields,
    isFieldVisible,
    onChange,
    selectedAddOns,
    selectedOptions,
    selectedPlanId,
    total,
  ]);

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
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    const field = customFields.find((item) => item.id === fieldId);
    if (field) {
      const error = validateFieldValue(field, value);
      setFieldErrors((prev) => {
        if (error) {
          return { ...prev, [fieldId]: error };
        }
        if (prev[fieldId]) {
          const { [fieldId]: _removed, ...rest } = prev;
          return rest;
        }
        return prev;
      });
    }
  };

  const handleApplyPreset = useCallback(
    (preset: ConfiguratorPreset) => {
      const normalized = sanitizePresetApplication(preset);
      setSelectedOptions((prev) =>
        shallowEqualOptionRecords(prev, normalized.options) ? prev : normalized.options,
      );
      setSelectedAddOns((prev) =>
        shallowEqualStringArrays(prev, normalized.addOns) ? prev : normalized.addOns,
      );
      setSelectedPlanId((prev) => (prev === normalized.planId ? prev : normalized.planId));
      setCustomFieldValues((prev) =>
        shallowEqualStringRecord(prev, normalized.fields) ? prev : normalized.fields,
      );

      const nextErrors: Record<string, string> = {};
      customFields.forEach((field) => {
        const value = normalized.fields[field.id] ?? "";
        const error = validateFieldValue(field, value);
        if (error) {
          nextErrors[field.id] = error;
        }
      });
      setFieldErrors(nextErrors);
      setActivePresetId(preset.id);
    },
    [customFields, sanitizePresetApplication, validateFieldValue],
  );

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

      {sortedPresets.length > 0 ? (
        <div className="mt-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-white/50">Configuration presets</p>
              <p className="text-xs text-white/60">Apply blueprint-ready bundles curated by merchandising.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {sortedPresets.map((preset) => {
              const optionSelectionCount = Object.values(preset.selection.optionSelections).reduce(
                (total, values) => total + values.length,
                0,
              );
              const addOnCount = preset.selection.addOnIds.length;
              const customFieldCount = Object.keys(preset.selection.customFieldValues).length;
              const planLabel = preset.selection.subscriptionPlanId
                ? subscriptionPlans.find((plan) => plan.id === preset.selection.subscriptionPlanId)?.label
                : null;
              const isActive = activePresetId === preset.id;
              return (
                <article
                  key={preset.id}
                  className={`relative flex flex-col gap-3 rounded-2xl border p-4 transition ${
                    isActive ? "border-white/70 bg-white/10" : "border-white/15 bg-black/30"
                  }`}
                  data-testid={`preset-card-${preset.id}`}
                >
                  {preset.heroImageUrl ? (
                    <div className="relative h-40 overflow-hidden rounded-xl border border-white/10">
                      <Image
                        src={preset.heroImageUrl}
                        alt={preset.label}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover"
                      />
                      {preset.badge ? (
                        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                          {preset.badge}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-white">{preset.label}</p>
                    {preset.summary ? <p className="text-xs text-white/60">{preset.summary}</p> : null}
                    {preset.priceHint ? (
                      <p className="text-xs text-white/50">Price hint: {preset.priceHint}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-wide text-white/50">
                    <span>
                      {optionSelectionCount} option{optionSelectionCount === 1 ? "" : "s"}
                    </span>
                    {addOnCount > 0 ? (
                      <span>
                        {addOnCount} add-on{addOnCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {planLabel ? <span>{planLabel}</span> : null}
                    {customFieldCount > 0 ? (
                      <span>
                        {customFieldCount} field value{customFieldCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    disabled={isActive}
                    data-testid={`apply-preset-${preset.id}`}
                    className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                      isActive
                        ? "border border-white/40 text-white/70"
                        : "border border-white/30 text-white hover:border-white/60"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {isActive ? "Preset applied" : "Apply preset"}
                  </button>
                </article>
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
                  const structured = option.structuredPricing ?? null;
                  const discountTiers = structured?.discountTiers ?? null;
                  const primaryPrice =
                    structured && typeof structured.basePrice === "number"
                      ? formatCurrency(structured.basePrice, currency)
                      : null;
                  const deltaValue =
                    structured && typeof structured.basePrice === "number"
                      ? group.type === "single"
                        ? structured.basePrice - basePrice
                        : structured.basePrice
                      : option.priceDelta;
                  const deltaLabel = formatCurrencyDelta(deltaValue, currency);
                  const metadata = option.metadata ?? null;
                  const marketingTagline =
                    metadata && typeof metadata.marketingTagline === "string" ? metadata.marketingTagline : null;
                  const fulfillmentSla =
                    metadata && typeof metadata.fulfillmentSla === "string" ? metadata.fulfillmentSla : null;
                  const heroImageUrl =
                    metadata && typeof metadata.heroImageUrl === "string" ? metadata.heroImageUrl : null;
                  const calculator = metadata?.calculator ?? null;
                  const sampleAmount =
                    calculator && typeof calculator.sampleAmount === "number" && Number.isFinite(calculator.sampleAmount)
                      ? calculator.sampleAmount
                      : null;
                  const sampleDays =
                    calculator && typeof calculator.sampleDays === "number" && Number.isFinite(calculator.sampleDays)
                      ? calculator.sampleDays
                      : null;
                  const calculatorResult = evaluateCalculatorPreview(calculator);
                  const hasBlueprintDetails =
                    Boolean(marketingTagline) ||
                    Boolean(fulfillmentSla) ||
                    Boolean(heroImageUrl) ||
                    Boolean(calculator?.expression);

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
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <span className="text-sm font-semibold text-white">{option.label}</span>
                          {structured ? (
                            <p className="text-xs text-white/60">
                              {structured.amount.toLocaleString()} {structured.amountUnit}
                              {structured.unitPrice != null
                                ? ` · ${new Intl.NumberFormat("en-US", {
                                    style: "currency",
                                    currency,
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }).format(structured.unitPrice)} / ${structured.amountUnit}`
                                : ""}
                              {structured.dripMinPerDay != null ? ` · Drip ≥ ${structured.dripMinPerDay}/day` : ""}
                            </p>
                          ) : null}
                          {option.description ? (
                            <p className="text-sm text-white/60">{option.description}</p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          {primaryPrice ? (
                            <p className="text-sm font-semibold text-white">{primaryPrice}</p>
                          ) : null}
                          <p className="text-xs text-white/60">{deltaLabel}</p>
                        </div>
                      </div>
                      {discountTiers && discountTiers.length > 0 ? (
                        <ul className="mt-3 flex flex-wrap gap-2 text-[0.7rem] text-white/60">
                          {discountTiers.map((tier) => (
                            <li
                              key={`${tier.minAmount}-${tier.unitPrice}-${tier.label ?? "tier"}`}
                              className="rounded-full border border-white/15 px-2 py-0.5"
                            >
                              {tier.label ? `${tier.label} · ` : ""}
                              {tier.minAmount.toLocaleString()}+
                              {" @ "}
                              {new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency,
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }).format(tier.unitPrice)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {hasBlueprintDetails ? (
                        <div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          {heroImageUrl ? (
                            <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                              <Image
                                src={heroImageUrl}
                                alt={`${option.label} hero`}
                                width={600}
                                height={256}
                                className="h-32 w-full object-cover"
                                loading="lazy"
                              />
                            </figure>
                          ) : null}
                          {marketingTagline ? (
                            <p className="text-sm font-medium text-white/80">{marketingTagline}</p>
                          ) : null}
                          {fulfillmentSla ? (
                            <p className="text-xs uppercase tracking-wide text-white/50">{fulfillmentSla}</p>
                          ) : null}
                          {calculator && calculator.expression ? (
                            <div className="text-xs text-white/60">
                              <p className="font-semibold uppercase tracking-wide text-white/40">Calculator</p>
                              <p>
                                Expr: <code className="text-white/70">{calculator.expression}</code>
                              </p>
                              {calculatorResult != null ? (
                                <p className="mt-1">
                                  Sample{" "}
                                  {calculatorResult.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                  {sampleAmount != null ? ` · amount ${sampleAmount}` : ""}
                                  {sampleDays != null ? ` · days ${sampleDays}` : ""}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
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
              const info = getAddOnPricingInfo(addOn.metadata ?? addOn.metadataJson ?? null, addOn.pricing ?? null);
              const preview = formatAddOnPreview(info, addOn.computedDelta ?? addOn.priceDelta, currency);
              const marginInsight =
                info.mode === "serviceOverride"
                  ? buildAddOnMarginInsight({
                      addOn,
                      info,
                      productCurrency: currency,
                      subtotalBeforeAddOns,
                      fxRates,
                    })
                  : null;
              const conflictInsight =
                info.mode === "serviceOverride"
                  ? analyzeServiceRuleConflicts(info.serviceRules ?? null, activeChannel)
                  : null;
              const marginStyle = marginInsight ? resolveMarginBadgeStyle(marginInsight.status) : null;
              const providerCostSummary =
                marginInsight != null ? formatProviderCostSummary(marginInsight, currency) : null;
              const marginLabel =
                marginInsight != null ? formatMarginLabel(marginInsight, currency) : "Pending input";

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
                    <span className="text-sm text-white/70">{preview.primary}</span>
                  </div>
                  {addOn.description ? (
                    <p className="mt-2 text-sm text-white/60">{addOn.description}</p>
                  ) : null}
                  {preview.secondary ? (
                    <p className="mt-1 text-xs text-white/50">{preview.secondary}</p>
                  ) : null}
                  {info.mode === "serviceOverride" && marginInsight && marginStyle ? (
                    <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] ${marginStyle.badge}`}
                          data-testid={`addon-${addOn.id}-margin`}
                        >
                          {marginStyle.label} · {marginLabel}
                        </span>
                        {providerCostSummary ? (
                          <span className="text-xs text-white/60">Cost {providerCostSummary}</span>
                        ) : null}
                      </div>
                      {marginInsight.guardrailSummary ? (
                        <p className="text-[0.65rem] text-white/50">{marginInsight.guardrailSummary}</p>
                      ) : null}
                      {marginInsight.requiresConversion ? (
                        <p
                          className="text-[0.65rem] text-amber-200"
                          data-testid={`addon-${addOn.id}-fx-warning`}
                        >
                          FX conversion from {marginInsight.providerCurrency} to {currency} required before evaluating
                          guardrails.
                        </p>
                      ) : null}
                      {conflictInsight ? (
                        <div
                          className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[0.7rem] text-rose-100"
                          data-testid={`addon-${addOn.id}-conflicts`}
                        >
                          {conflictInsight.messages.map((message) => (
                            <p key={message}>{message}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
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
            {customFields.map((field) => {
              if (!isFieldVisible(field)) {
                return null;
              }
              const value = customFieldValues[field.id] ?? field.defaultValue ?? "";
              const errorMessage = fieldErrors[field.id];
              const validation = field.validation ?? {};
              const minLengthAttr = validation.minLength ?? undefined;
              const maxLengthAttr = validation.maxLength ?? undefined;
              const patternAttr = field.type !== "number" ? validation.pattern : undefined;
              const minValueAttr = field.type === "number" && validation.minValue != null ? validation.minValue : undefined;
              const maxValueAttr = field.type === "number" && validation.maxValue != null ? validation.maxValue : undefined;
              const numericStepAttr = field.type === "number" && validation.numericStep != null ? validation.numericStep : undefined;
              const allowedValues = validation.allowedValues ?? [];
              const datalistId = allowedValues.length > 0 ? `allowed-${field.id}` : undefined;
              const inputClassName = `w-full rounded-xl px-4 py-2 text-sm text-white outline-none transition ${
                errorMessage
                  ? "border-red-400/60 bg-red-500/10 focus:border-red-400/80"
                  : "border-white/15 bg-white/5 focus:border-white/40"
              }`;

              return (
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
                    value={value}
                    onChange={(event) => handleFieldChange(field.id, event.target.value)}
                  placeholder={field.placeholder}
                  minLength={field.type !== "number" ? minLengthAttr : undefined}
                  maxLength={field.type !== "number" ? maxLengthAttr : undefined}
                  pattern={patternAttr}
                  min={field.type === "number" ? minValueAttr : undefined}
                  max={field.type === "number" ? maxValueAttr : undefined}
                  step={numericStepAttr}
                  aria-invalid={errorMessage ? "true" : "false"}
                  list={datalistId}
                  className={inputClassName}
                />
                  {datalistId ? (
                    <datalist id={datalistId}>
                      {allowedValues.map((option) => (
                        <option key={`${field.id}-${option}`} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                  {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
                  {field.helpText ? <p className="text-xs text-white/50">{field.helpText}</p> : null}
                  {allowedValues.length > 0 ? (
                    <p className="text-xs text-white/50">Allowed values: {allowedValues.join(", ")}</p>
                  ) : null}
                  {field.sampleValues && field.sampleValues.length > 0 ? (
                    <p className="text-xs text-white/50">Sample values: {field.sampleValues.join(", ")}</p>
                  ) : null}
                  {numericStepAttr ? (
                    <p className="text-xs text-white/50">Use increments of {numericStepAttr}.</p>
                  ) : null}
                </div>
              );
            })}
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
