"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { FaqAccordion } from "@/components/faq/accordion";
import {
  ProductConfigurator,
  type ConfiguratorAddOn,
  type ConfiguratorCustomField,
  type ConfiguratorOptionGroup,
  type ConfiguratorPreset,
  type ConfiguratorSelection,
  type SubscriptionPlan
} from "@/components/products/product-configurator";
import { useCartStore, cartTotalSelector } from "@/store/cart";
import {
  useSavedConfigurationsStore,
  type SavedConfiguration
} from "@/store/saved-configurations";
import { calculateAddOnDelta, calculateOptionDelta, getAddOnPricingInfo } from "@/lib/product-pricing";
import { normalizeCustomFieldMetadata as sharedNormalizeCustomFieldMetadata } from "@/lib/product-metadata";
import type {
  ProductDetail,
  ProductAddOn,
  ProductOptionGroup,
  ProductOptionStructuredPricing,
  ProductOptionMetadata,
} from "@/types/product";
import type {
  CartAddOnSelection,
  CartCustomFieldValue,
  CartOptionCalculatorPreview,
  CartOptionSelection,
  CartProductExperience,
  CartSubscriptionSelection,
} from "@/types/cart";
import type { CatalogBundleRecommendation, CatalogExperimentResponse } from "@smplat/types";
import type { PricingExperiment, PricingExperimentVariant } from "@/types/pricing-experiments";
import { selectPricingExperimentVariant } from "@/lib/pricing-experiments";
import { logPricingExperimentEvents } from "@/lib/pricing-experiment-events";
import {
  buildBundleExperimentOverlay,
  hasGuardrailBreaches,
} from "../experiment-overlay";
import type { MarketingContent } from "../marketing-content";
import { ProductExperienceCard } from "@/components/storefront/product-experience-card";
import type { StorefrontProduct } from "@/data/storefront-experience";

type ConfigSelection = {
  total: number;
  selectedOptions: Record<string, string[]>;
  addOns: string[];
  subscriptionPlanId?: string;
  customFieldValues: Record<string, string>;
  presetId?: string | null;
};

type SelectedOptionDetail = CartOptionSelection;
type SelectedAddOnDetail = CartAddOnSelection;

type ProductDetailClientProps = {
  product: ProductDetail;
  marketing: MarketingContent;
  recommendations: CatalogBundleRecommendation[];
  recommendationFallback?: string | null;
  experiments: CatalogExperimentResponse[];
  pricingExperiments: PricingExperiment[];
};

const PRICING_EXPERIMENT_SESSION_KEY = "smplat.pricingExperimentExposures";

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

function formatCurrencyDelta(amount: number, currency: string): string {
  const formatted = formatCurrency(Math.abs(amount), currency);
  if (amount === 0) {
    return formatted;
  }
  return amount > 0 ? `+${formatted}` : `-${formatted}`;
}

const formatPricingExperimentAdjustment = (
  variant: PricingExperimentVariant,
  currency: string,
): string => {
  if (variant.adjustmentKind === "multiplier") {
    if (typeof variant.priceMultiplier === "number" && Number.isFinite(variant.priceMultiplier)) {
      return `${variant.priceMultiplier.toFixed(2)}× base`;
    }
    return "Multiplier TBD";
  }
  if (variant.priceDeltaCents === 0) {
    return "No change";
  }
  const dollars = variant.priceDeltaCents / 100;
  const formatted = formatCurrency(Math.abs(dollars), currency);
  return variant.priceDeltaCents > 0 ? `+${formatted}` : `-${formatted}`;
};

function formatPercentage(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return `${Math.round(value * 100)}%`;
}

function formatQueueDepth(count: number): string {
  if (count <= 0) {
    return "Clear";
  }
  if (count <= 5) {
    return `${count} queued`;
  }
  return `${count}+ queued`;
}

const isSafeCalculatorExpression = (expression: string): boolean => {
  const sanitized = expression
    .replace(/\bamount\b/gi, "")
    .replace(/\bdays\b/gi, "")
    .replace(/[0-9+\-*/().\s]/g, "");
  return sanitized.trim().length === 0;
};

const evaluateCalculatorSample = (
  expression: string,
  amount: number | null | undefined,
  days: number | null | undefined
): number | null => {
  const trimmed = expression.trim();
  if (!trimmed || !isSafeCalculatorExpression(trimmed)) {
    return null;
  }
  try {
    const fn = Function("amount", "days", `return ${trimmed};`) as (amount: number, days: number) => unknown;
    const resolvedAmount = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
    const resolvedDays = typeof days === "number" && Number.isFinite(days) ? days : 0;
    const result = fn(resolvedAmount, resolvedDays);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

const buildCalculatorPreview = (
  metadata: ProductOptionMetadata["calculator"] | null | undefined
): CartOptionCalculatorPreview | null => {
  if (!metadata || typeof metadata.expression !== "string") {
    return null;
  }
  const expression = metadata.expression.trim();
  if (!expression || !isSafeCalculatorExpression(expression)) {
    return null;
  }
  const sampleAmount =
    metadata.sampleAmount != null && Number.isFinite(metadata.sampleAmount) ? metadata.sampleAmount : null;
  const sampleDays =
    metadata.sampleDays != null && Number.isFinite(metadata.sampleDays) ? metadata.sampleDays : null;
  const sampleResult = evaluateCalculatorSample(expression, sampleAmount, sampleDays);
  return {
    expression,
    sampleAmount,
    sampleDays,
    sampleResult,
  };
};

function mapOptionGroups(groups: ProductOptionGroup[]): ConfiguratorOptionGroup[] {
  return groups
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description ?? undefined,
      type: group.groupType === "multiple" ? "multiple" : "single",
      required: group.isRequired,
      metadata: group.metadataJson ?? null,
      options: group.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? undefined,
          priceDelta: option.priceDelta,
          recommended: option.metadataJson?.recommended === true,
          structuredPricing: option.metadataJson?.structuredPricing ?? null,
          media: option.metadataJson?.media ?? null,
          metadata: option.metadataJson ?? null
        }))
    }));
}

function mapAddOns(addOns: ProductDetail["addOns"]): ConfiguratorAddOn[] {
  return addOns
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((addOn) => ({
      id: addOn.id,
      label: addOn.label,
      description: addOn.description ?? undefined,
      priceDelta: addOn.priceDelta,
      recommended: addOn.isRecommended,
      metadata: addOn.metadataJson ?? null,
      metadataJson: addOn.metadataJson ?? null,
      pricing: addOn.pricing ?? null,
      computedDelta: addOn.computedDelta ?? addOn.priceDelta,
      percentageMultiplier: addOn.percentageMultiplier ?? null
    }));
}

function mapCustomFields(fields: ProductDetail["customFields"]): ConfiguratorCustomField[] {
  return fields
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .filter((field) => {
      const metadata = sharedNormalizeCustomFieldMetadata(field.metadataJson);
      const checkout =
        metadata.passthrough && typeof metadata.passthrough.checkout === "boolean"
          ? metadata.passthrough.checkout
          : true;
      return checkout && field.label.trim().length > 0;
    })
    .map((field) => {
      const metadata = sharedNormalizeCustomFieldMetadata(field.metadataJson);
      const validation =
        metadata.validation && Object.keys(metadata.validation).length > 0
          ? metadata.validation
          : undefined;
      const passthrough =
        metadata.passthrough && typeof metadata.passthrough.fulfillment === "boolean"
          ? { fulfillment: metadata.passthrough.fulfillment }
          : undefined;
      return {
        id: field.id,
        label: field.label,
        type: field.fieldType,
        placeholder: field.placeholder ?? undefined,
        helpText: field.helpText ?? undefined,
        required: field.isRequired,
        validation,
        passthrough,
        defaultValue:
          typeof metadata.defaultValue === "string" && metadata.defaultValue.length > 0
            ? metadata.defaultValue
            : undefined,
        conditional: metadata.conditionalVisibility ?? undefined,
        sampleValues: metadata.sampleValues ?? undefined,
      } satisfies ConfiguratorCustomField;
    });
}

function mapSubscriptionPlans(plans: ProductDetail["subscriptionPlans"]): SubscriptionPlan[] {
  return plans
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((plan) => ({
      id: plan.id,
      label: plan.label,
      description: plan.description ?? undefined,
      billingCycle:
        plan.billingCycle === "monthly"
          ? "monthly"
          : plan.billingCycle === "quarterly"
            ? "quarterly"
            : plan.billingCycle === "annual"
              ? "annual"
              : "one-time",
      priceMultiplier: plan.priceMultiplier ?? undefined,
      priceDelta: plan.priceDelta ?? undefined,
      default: plan.isDefault
    }));
}

function mapConfigurationPresets(presets: ProductDetail["configurationPresets"]): ConfiguratorPreset[] {
  return (presets ?? [])
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((preset, index) => ({
      id: preset.id ?? `preset-${index}`,
      label: preset.label,
      summary: preset.summary ?? null,
      heroImageUrl: preset.heroImageUrl ?? null,
      badge: preset.badge ?? null,
      priceHint: preset.priceHint ?? null,
      displayOrder: preset.displayOrder ?? null,
      selection: {
        optionSelections: preset.selection.optionSelections,
        addOnIds: preset.selection.addOnIds,
        subscriptionPlanId: preset.selection.subscriptionPlanId ?? undefined,
        customFieldValues: preset.selection.customFieldValues,
      },
    }));
}

function renderStars(rating: number): string {
  const clamped = Math.min(Math.max(Math.round(rating), 0), 5);
  return `${"★".repeat(clamped)}${"☆".repeat(5 - clamped)}`;
}

function cloneSelection(selection: ConfigSelection): ConfiguratorSelection {
  return {
    selectedOptions: Object.fromEntries(
      Object.entries(selection.selectedOptions).map(([groupId, optionIds]) => [
        groupId,
        [...optionIds]
      ])
    ),
    addOns: [...selection.addOns],
    subscriptionPlanId: selection.subscriptionPlanId,
    customFieldValues: { ...selection.customFieldValues },
    presetId: selection.presetId ?? null,
  };
}

function buildPresetSelection(preset: ConfiguratorPreset): ConfiguratorSelection {
  return {
    selectedOptions: Object.fromEntries(
      Object.entries(preset.selection.optionSelections).map(([groupId, optionIds]) => [
        groupId,
        [...optionIds]
      ])
    ),
    addOns: [...preset.selection.addOnIds],
    subscriptionPlanId: preset.selection.subscriptionPlanId,
    customFieldValues: { ...preset.selection.customFieldValues },
    presetId: preset.id ?? null,
  };
}

type PresetAnalyticsEvent = {
  productSlug: string;
  presetId: string | null;
  presetLabel?: string | null;
  source: "marketing-card" | "configurator";
  eventType: string;
};

async function recordPresetAnalyticsEvent({
  productSlug,
  presetId,
  presetLabel,
  source,
  eventType,
}: PresetAnalyticsEvent) {
  if (!presetId) {
    return;
  }
  try {
    await fetch("/api/analytics/offer-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerSlug: productSlug,
        eventType,
        action: "apply",
        metadata: {
          presetId,
          presetLabel: presetLabel ?? null,
          source,
        },
      }),
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("Failed to record preset analytics event", error);
    }
  }
}

type PriceBreakdownItem = {
  id: string;
  label: string;
  amount: number;
  variant: "base" | "option" | "addOn" | "plan";
};

function computeOptionDelta(
  option: ProductOptionGroup["options"][number],
  groupType: ProductOptionGroup["groupType"],
  productBasePrice: number
): number {
  return calculateOptionDelta(option, productBasePrice, groupType);
}

function computeAddOnDelta(addOn: ProductAddOn, subtotal: number): number {
  return calculateAddOnDelta(addOn, subtotal);
}

function computePriceBreakdown(product: ProductDetail, selection: ConfigSelection): PriceBreakdownItem[] {
  const items: PriceBreakdownItem[] = [
    {
      id: "base",
      label: "Base service",
      amount: product.basePrice,
      variant: "base"
    }
  ];

  let running = product.basePrice;

  product.optionGroups.forEach((group) => {
    const selectedIds = selection.selectedOptions[group.id] ?? [];
    selectedIds.forEach((id) => {
      const option = group.options.find((opt) => opt.id === id);
      if (!option) {
        return;
      }
      const delta = computeOptionDelta(option, group.groupType, product.basePrice);
      items.push({
        id: `option-${group.id}-${option.id}`,
        label: `${group.name}: ${option.label}`,
        amount: delta,
        variant: "option"
      });
      running += delta;
    });
  });

  selection.addOns.forEach((id) => {
    const addOn = product.addOns.find((item) => item.id === id);
    if (!addOn) {
      return;
    }
    const delta = computeAddOnDelta(addOn, running);
    items.push({
      id: `addon-${addOn.id}`,
      label: addOn.label,
      amount: delta,
      variant: "addOn"
    });
    running += delta;
  });

  const plan = selection.subscriptionPlanId
    ? product.subscriptionPlans.find((item) => item.id === selection.subscriptionPlanId)
    : undefined;

  if (plan) {
    if (plan.priceDelta) {
      items.push({
        id: `plan-delta-${plan.id}`,
        label: `${plan.label} adjustment`,
        amount: plan.priceDelta,
        variant: "plan"
      });
      running += plan.priceDelta;
    }

    if (plan.priceMultiplier) {
      const adjusted = Math.round(running * plan.priceMultiplier);
      const delta = adjusted - running;
      items.push({
        id: `plan-multiplier-${plan.id}`,
        label: `${plan.label} multiplier (x${plan.priceMultiplier.toFixed(2)})`,
        amount: delta,
        variant: "plan"
      });
      running = adjusted;
    }
  }

  return items;
}

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProductDetailClient({
  product,
  marketing,
  recommendations,
  recommendationFallback,
  experiments,
  pricingExperiments,
  storefrontProduct,
}: ProductDetailClientProps) {
  const [selection, setSelection] = useState<ConfigSelection>({
    total: product.basePrice,
    selectedOptions: {},
    addOns: [],
    subscriptionPlanId: product.subscriptionPlans.find((plan) => plan.isDefault)?.id,
    customFieldValues: {},
    presetId: null
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [configPreset, setConfigPreset] = useState<ConfiguratorSelection | undefined>(undefined);
  const configuratorSectionRef = useRef<HTMLDivElement | null>(null);
  const lastConfiguratorPresetRef = useRef<string | null>(null);

  const addItem = useCartStore((state) => state.addItem);
  const cartTotal = useCartStore(cartTotalSelector);
  const { configurations: savedConfigurations, saveConfiguration, updateConfigurationLabel, deleteConfiguration } =
    useSavedConfigurationsStore((state) => ({
      configurations: state.configurations.filter((config) => config.productId === product.id),
      saveConfiguration: state.saveConfiguration,
      updateConfigurationLabel: state.updateConfigurationLabel,
      deleteConfiguration: state.deleteConfiguration
    }));

  const optionGroups = useMemo(() => mapOptionGroups(product.optionGroups), [product.optionGroups]);
  const addOns = useMemo(() => mapAddOns(product.addOns), [product.addOns]);
  const customFields = useMemo(() => mapCustomFields(product.customFields), [product.customFields]);
  const subscriptionPlans = useMemo(
    () => mapSubscriptionPlans(product.subscriptionPlans),
    [product.subscriptionPlans]
  );
  const configurationPresets = useMemo(
    () => mapConfigurationPresets(product.configurationPresets ?? []),
    [product.configurationPresets]
  );
  const presetLabelLookup = useMemo(() => {
    const map = new Map<string, string>();
    configurationPresets.forEach((preset) => {
      if (preset.id) {
        map.set(preset.id, preset.label);
      }
    });
    return map;
  }, [configurationPresets]);

  useEffect(() => {
    const currentPresetId = selection.presetId ?? null;
    const previousPresetId = lastConfiguratorPresetRef.current;

    if (currentPresetId && currentPresetId !== previousPresetId) {
      lastConfiguratorPresetRef.current = currentPresetId;
      const presetLabel = presetLabelLookup.get(currentPresetId) ?? null;
      void recordPresetAnalyticsEvent({
        productSlug: product.slug,
        presetId: currentPresetId,
        presetLabel,
        source: "configurator",
        eventType: "preset_configurator_apply",
      });
      return;
    }

    if (!currentPresetId && previousPresetId) {
      lastConfiguratorPresetRef.current = null;
      const presetLabel = presetLabelLookup.get(previousPresetId) ?? null;
      void recordPresetAnalyticsEvent({
        productSlug: product.slug,
        presetId: previousPresetId,
        presetLabel,
        source: "configurator",
        eventType: "preset_configurator_clear",
      });
      return;
    }

    if (!currentPresetId) {
      lastConfiguratorPresetRef.current = null;
    }
  }, [presetLabelLookup, product.slug, selection.presetId]);
  const mediaGallery = useMemo(
    () =>
      (product.mediaAssets ?? [])
        .slice()
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    [product.mediaAssets]
  );

  const computeFieldError = useCallback((field: ConfiguratorCustomField, rawValue: string): string | null => {
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
        // ignore malformed regex at runtime
      }
    }

    return null;
  }, []);
  const priceBreakdown = useMemo(
    () => computePriceBreakdown(product, selection),
    [product, selection]
  );
  const experimentOverlay = useMemo(
    () => buildBundleExperimentOverlay(experiments),
    [experiments]
  );
  const experimentSummaries = useMemo(
    () =>
      experiments.map((experiment) => {
        const variants = experiment.variants.map((variant) => {
          const metric = variant.metrics
            .slice()
            .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0];
          return {
            key: variant.key,
            name: variant.name,
            bundleSlug: variant.bundleSlug,
            isControl: variant.isControl,
            guardrailBreached: metric?.guardrailBreached ?? false,
            acceptanceRate: metric?.acceptanceRate ?? null,
            sampleSize: metric?.sampleSize ?? null,
          };
        });
        const guardrailTriggered =
          experiment.status === "paused" || variants.some((variant) => variant.guardrailBreached);
        return {
          slug: experiment.slug,
          name: experiment.name,
          status: experiment.status,
          guardrailTriggered,
          variants,
        };
      }),
    [experiments]
  );

  const visiblePricingExperiments = useMemo(
    () => pricingExperiments.filter((experiment) => experiment.variants.length > 0),
    [pricingExperiments],
  );

  useEffect(() => {
    if (visiblePricingExperiments.length === 0) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    let storedKeys: string[] = [];
    try {
      storedKeys = JSON.parse(window.sessionStorage.getItem(PRICING_EXPERIMENT_SESSION_KEY) ?? "[]");
      if (!Array.isArray(storedKeys)) {
        storedKeys = [];
      }
    } catch {
      storedKeys = [];
    }

    const seen = new Set(storedKeys);
    const events: Array<{ slug: string; variantKey: string; exposures: number }> = [];

    visiblePricingExperiments.forEach((experiment) => {
      const variant = selectPricingExperimentVariant(experiment);
      if (!variant) {
        return;
      }
      const dedupKey = `${experiment.slug}:${variant.key}`;
      if (seen.has(dedupKey)) {
        return;
      }
      seen.add(dedupKey);
      events.push({
        slug: experiment.slug,
        variantKey: variant.key,
        exposures: 1,
      });
    });

    if (events.length === 0) {
      return;
    }

    try {
      window.sessionStorage.setItem(PRICING_EXPERIMENT_SESSION_KEY, JSON.stringify(Array.from(seen)));
    } catch {
      // ignore storage failures
    }

    logPricingExperimentEvents(events).catch((error) => {
      console.warn("Failed to log pricing experiment exposures", error);
    });
  }, [visiblePricingExperiments]);

  const handleConfiguratorChange = (next: ConfigSelection) => {
    setSelection(next);
    setErrors([]);
    setConfirmation(null);
  };

  const focusConfigurator = useCallback(() => {
    if (configuratorSectionRef.current) {
      configuratorSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const applyConfigurationSelection = useCallback(
    (selectionDraft: ConfiguratorSelection, toast?: string) => {
      setConfigPreset(selectionDraft);
      if (toast) {
        setConfirmation(toast);
      } else {
        setConfirmation(null);
      }
      setErrors([]);
      focusConfigurator();
    },
    [focusConfigurator]
  );

  const validateCustomFields = (): string[] => {
    const issues: string[] = [];
    customFields.forEach((field) => {
      const value = selection.customFieldValues[field.id] ?? "";
      const error = computeFieldError(field, value);
      if (error) {
        issues.push(error);
      }
    });
    return issues;
  };

  const handleSaveConfiguration = () => {
    const defaultLabel = `${product.title} • ${formatTimestamp(new Date().toISOString())}`;
    const input = window.prompt("Name this configuration", defaultLabel);
    if (input === null) {
      return;
    }
    const label = input.trim();
    if (!label) {
      return;
    }
    const snapshot = cloneSelection(selection);
    saveConfiguration({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      label,
      currency: product.currency,
      total: selection.total,
      selection: snapshot
    });
    setConfirmation(`Saved configuration "${label}".`);
    setErrors([]);
  };

  const handleApplySavedConfiguration = (config: SavedConfiguration) => {
    applyConfigurationSelection(cloneSelection(config.selection), `Applied "${config.label}" configuration.`);
  };

  const handleApplyMarketingPreset = (preset: ConfiguratorPreset) => {
    applyConfigurationSelection(buildPresetSelection(preset), `Applied "${preset.label}" preset.`);
    void recordPresetAnalyticsEvent({
      productSlug: product.slug,
      presetId: preset.id ?? null,
      presetLabel: preset.label,
      eventType: "preset_cta_apply",
      source: "marketing-card",
    });
  };

  const handleRenameSavedConfiguration = (config: SavedConfiguration) => {
    const input = window.prompt("Rename configuration", config.label);
    if (input === null) {
      return;
    }
    const nextLabel = input.trim();
    if (!nextLabel || nextLabel === config.label) {
      return;
    }
    updateConfigurationLabel(config.id, nextLabel);
    setConfirmation(`Renamed configuration to "${nextLabel}".`);
  };

  const handleDeleteSavedConfiguration = (config: SavedConfiguration) => {
    const confirmed = window.confirm(`Remove saved configuration "${config.label}"?`);
    if (!confirmed) {
      return;
    }
    deleteConfiguration(config.id);
    setConfirmation(`Removed configuration "${config.label}".`);
  };

  const handleAddToCart = () => {
    const validationErrors = validateCustomFields();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setConfirmation(null);
      return;
    }

    const selectedOptionDetails: SelectedOptionDetail[] = [];
    let runningSubtotal = product.basePrice;

    product.optionGroups.forEach((group) => {
      const ids = selection.selectedOptions[group.id] ?? [];
      ids.forEach((id) => {
        const option = group.options.find((opt) => opt.id === id);
        if (!option) {
          return;
        }
        const delta = computeOptionDelta(option, group.groupType, product.basePrice);
        const metadata: ProductOptionMetadata | null | undefined = option.metadataJson ?? null;
        const calculatorPreview = buildCalculatorPreview(metadata?.calculator);
        selectedOptionDetails.push({
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          label: option.label,
          priceDelta: delta,
          structuredPricing: metadata?.structuredPricing ?? null,
          marketingTagline: metadata?.marketingTagline ?? null,
          fulfillmentSla: metadata?.fulfillmentSla ?? null,
          heroImageUrl: metadata?.heroImageUrl ?? null,
          calculator: calculatorPreview,
        });
        runningSubtotal += delta;
      });
    });

    const selectedAddOnDetails: SelectedAddOnDetail[] = [];
    selection.addOns.forEach((id) => {
      const addOn = product.addOns.find((item) => item.id === id);
      if (!addOn) {
        return;
      }
      const delta = computeAddOnDelta(addOn, runningSubtotal);
      const pricingInfo = getAddOnPricingInfo(addOn.metadataJson, addOn.pricing ?? null);
      selectedAddOnDetails.push({
        id: addOn.id,
        label: addOn.label,
        priceDelta: delta,
        pricingMode: pricingInfo.mode,
        pricingAmount: pricingInfo.amount ?? null,
        serviceId: pricingInfo.mode === "serviceOverride" ? pricingInfo.serviceId ?? null : null,
        serviceProviderId: pricingInfo.serviceProviderId ?? null,
        serviceProviderName: pricingInfo.serviceProviderName ?? null,
        serviceAction: pricingInfo.serviceAction ?? null,
        serviceDescriptor: pricingInfo.serviceDescriptor ?? null,
        providerCostAmount: pricingInfo.providerCostAmount ?? null,
        providerCostCurrency: pricingInfo.providerCostCurrency ?? null,
        marginTarget: pricingInfo.marginTarget ?? null,
        fulfillmentMode: pricingInfo.fulfillmentMode ?? undefined,
        payloadTemplate: pricingInfo.payloadTemplate ?? null,
        dripPerDay: pricingInfo.dripPerDay ?? null,
        previewQuantity: pricingInfo.previewQuantity ?? null,
        serviceRules: pricingInfo.serviceRules ?? null,
      });
      runningSubtotal += delta;
    });

    const subscriptionSelection = selection.subscriptionPlanId
      ? product.subscriptionPlans.find((plan) => plan.id === selection.subscriptionPlanId)
      : undefined;

    const presetLabel = selection.presetId ? presetLabelLookup.get(selection.presetId) ?? null : null;
    const cartExperience: CartProductExperience | undefined = storefrontProduct
      ? {
          slug: storefrontProduct.slug,
          name: storefrontProduct.name,
          category: storefrontProduct.category,
          journeyInsight: storefrontProduct.journeyInsight,
          trustSignal: storefrontProduct.trustSignal,
          loyaltyHint: storefrontProduct.loyaltyHint,
          highlights: storefrontProduct.highlights,
          sla: storefrontProduct.sla
        }
      : undefined;

    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      currency: product.currency,
      basePrice: product.basePrice,
      unitPrice: selection.total,
      selectedOptions: selectedOptionDetails,
      addOns: selectedAddOnDetails,
      subscriptionPlan: subscriptionSelection
        ? {
            id: subscriptionSelection.id,
            label: subscriptionSelection.label,
            billingCycle: subscriptionSelection.billingCycle,
            priceMultiplier: subscriptionSelection.priceMultiplier,
            priceDelta: subscriptionSelection.priceDelta
          }
        : undefined,
      customFields: product.customFields.map((field) => ({
        id: field.id,
        label: field.label,
        value: selection.customFieldValues[field.id] ?? ""
      })),
      deliveryEstimate: product.fulfillmentSummary?.delivery ?? null,
      assuranceHighlights: product.fulfillmentSummary?.assurances ?? [],
      supportChannels: product.fulfillmentSummary?.support ?? [],
      presetId: selection.presetId ?? null,
      presetLabel,
      experience: cartExperience
    });

    setConfirmation("Service configuration added to cart.");
    setErrors([]);
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-24 text-white">
      <header className="flex flex-col gap-6">
        <Link href="/products" className="text-sm text-white/60 transition hover:text-white/80">
          ← All services
        </Link>
        <div className="flex flex-col gap-8">
          <div className="space-y-4">
            {marketing.heroEyebrow ? (
              <span className="inline-flex items-center rounded-full border border-white/15 px-4 py-1 text-xs uppercase tracking-wide text-white/60">
                {marketing.heroEyebrow}
              </span>
            ) : null}
            <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">{product.title}</h1>
            <p className="text-lg text-white/70">
              {product.description ??
                marketing.heroSubheadline ??
                "SMPLAT orchestrates paid and organic experiments to compound reach, followers, and conversions."}
            </p>
            <div className="flex flex-wrap gap-4 text-sm text-white/60">
              <span>Category: {product.category}</span>
              <span>Starting at {formatCurrency(product.basePrice, product.currency)}</span>
              <span>Cart total: {formatCurrency(cartTotal, product.currency)}</span>
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.25fr,0.75fr]">
            {marketing.metrics.length > 0 ? (
              <div className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:grid-cols-3 sm:divide-x sm:divide-white/10">
                {marketing.metrics.map((metric) => (
                  <div key={metric.label} className="sm:px-4">
                    <p className="text-xs uppercase tracking-wide text-white/40">{metric.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
                    {metric.caption ? <p className="mt-1 text-xs text-white/60">{metric.caption}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <ProductExperienceCard product={storefrontProduct} />
          </div>
        </div>
      </header>

      {mediaGallery.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Product media gallery</h2>
              <p className="text-sm text-white/60">
                Ordered preview assets with hero/detail/social usage tags for buyers and operators.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-white/40">
              {mediaGallery.length} asset{mediaGallery.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mediaGallery.map((asset, index) => (
              <article
                key={asset.id ?? `${asset.assetUrl}-${index}`}
                className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
              >
                <div className="relative aspect-video w-full border-b border-white/10">
                  <Image
                    src={asset.assetUrl}
                    alt={asset.altText ?? asset.label ?? `Product asset ${index + 1}`}
                    fill
                    sizes="(max-width: 1024px) 100vw, 33vw"
                    className="object-cover"
                  />
                </div>
                <div className="space-y-2 p-4 text-sm text-white/70">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-white">{asset.label ?? "Untitled asset"}</p>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white/60">
                      #{(Number(asset.displayOrder) ?? index) + 1}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.25em] text-white/60">
                    {asset.isPrimary ? (
                      <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-emerald-200">Primary</span>
                    ) : null}
                    {(asset.usageTags ?? []).map((tag) => (
                      <span key={`${asset.id}-${tag}`} className="rounded-full border border-white/15 px-2 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {asset.altText ? <p className="text-xs text-white/50">Alt text: {asset.altText}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {marketing.gallery.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Campaign creative snapshots</h2>
              <p className="text-sm text-white/60">
                A peek at deliverables teams lean on when engagements ramp.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-white/40">
              {marketing.gallery.length} visuals
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {marketing.gallery.map((item) => (
              <figure
                key={item.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
              >
                <Image
                  src={item.imageUrl}
                  alt={item.title ?? "Campaign creative"}
                  width={640}
                  height={384}
                  className="h-56 w-full object-cover transition duration-300 hover:scale-105"
                  sizes="(max-width: 1024px) 100vw, 33vw"
                />
                <figcaption className="p-4 text-sm text-white/70">
                  <p className="font-semibold text-white">{item.title}</p>
                  {item.description ? <p className="mt-1 text-xs text-white/60">{item.description}</p> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {configurationPresets.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Curated configuration presets</h2>
              <p className="text-sm text-white/60">
                Ready-made bundles combining hero imagery, plan hints, and recommended add-ons.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-white/40">
              {configurationPresets.length} preset{configurationPresets.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {configurationPresets.map((preset, index) => {
              const presetActive = selection.presetId === preset.id;
              return (
                <article
                  key={preset.id ?? `preset-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
                >
                {preset.heroImageUrl ? (
                  <div className="relative h-44 w-full overflow-hidden border-b border-white/10">
                    <Image
                      src={preset.heroImageUrl}
                      alt={preset.label}
                      fill
                      sizes="(max-width: 1024px) 100vw, 33vw"
                      className="object-cover"
                    />
                    {preset.badge ? (
                      <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                        {preset.badge}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-2 p-4 text-sm text-white/70">
                  <div>
                    <p className="text-base font-semibold text-white">{preset.label}</p>
                    {preset.summary ? <p className="text-xs text-white/60">{preset.summary}</p> : null}
                  </div>
                  {preset.priceHint ? (
                    <p className="text-xs text-white/50">Price hint: {preset.priceHint}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-wide text-white/40">
                    {(() => {
                      const optionCount = Object.values(preset.selection.optionSelections).reduce(
                        (total, values) => total + values.length,
                        0
                      );
                      return (
                        <span>
                          {optionCount} option{optionCount === 1 ? "" : "s"}
                        </span>
                      );
                    })()}
                    {preset.selection.addOnIds.length > 0 ? (
                      <span>
                        {preset.selection.addOnIds.length} add-on{preset.selection.addOnIds.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {preset.selection.subscriptionPlanId ? <span>Plan linked</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyMarketingPreset(preset)}
                    disabled={presetActive}
                    className={`w-full rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                      presetActive ? "border-white/30 text-white/50" : "border-white/50 text-white hover:border-white/80"
                    }`}
                  >
                    {presetActive ? "Preset active" : "Apply in configurator"}
                  </button>
                </div>
              </article>
            );
            })}
          </div>
        </section>
      ) : null}

      {confirmation ? (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" data-testid="cart-notification">
          {confirmation}{" "}
          <Link href="/cart" className="font-semibold underline">
            View cart
          </Link>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="validation-error">
          <p className="font-semibold">Please fix the following:</p>
          <ul className="list-disc pl-6">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div ref={configuratorSectionRef}>
        <ProductConfigurator
          basePrice={product.basePrice}
          currency={product.currency}
          optionGroups={optionGroups}
          addOns={addOns}
          customFields={customFields}
          subscriptionPlans={subscriptionPlans}
          configurationPresets={configurationPresets}
          initialConfig={configPreset}
          onChange={handleConfiguratorChange}
          activeChannel="storefront"
          actions={
            <>
              <button
                type="button"
                onClick={handleAddToCart}
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
                data-testid="add-to-cart"
              >
                Add to cart
              </button>
              <button
                type="button"
                onClick={handleSaveConfiguration}
                className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
              >
                Save configuration
              </button>
              <Link
                href="/cart"
                className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
              >
                Go to cart
              </Link>
            </>
          }
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Saved configurations</h2>
              <p className="text-sm text-white/60">
                Snapshot campaign setups to reuse or iterate later.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-white/50">
              {savedConfigurations.length} saved
            </span>
          </div>
          {savedConfigurations.length === 0 ? (
            <p className="mt-6 text-sm text-white/60">
              Press <span className="font-semibold text-white">Save configuration</span> after dialing in your options
              to keep a reusable preset for future sessions.
            </p>
          ) : (
            <ul className="mt-6 space-y-4">
              {savedConfigurations.map((config) => (
                <li
                  key={config.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70 backdrop-blur"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{config.label}</p>
                      <p className="text-xs text-white/50">
                        {formatCurrency(config.total, config.currency)} • Updated {formatTimestamp(config.updatedAt)}
                      </p>
                      {config.selection.presetId ? (
                        <p className="mt-1 inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] text-white/60">
                          Preset: {presetLabelLookup.get(config.selection.presetId) ?? "Deprecated"}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleApplySavedConfiguration(config)}
                        className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRenameSavedConfiguration(config)}
                        className="rounded-full border border-white/25 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedConfiguration(config)}
                        className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">Price breakdown</h2>
          <p className="text-xs text-white/60">Track how each selection adjusts the projected investment.</p>
          <div className="mt-4 space-y-3">
            {priceBreakdown.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className={item.variant === "base" ? "font-semibold text-white" : "text-white/70"}>
                  {item.label}
                </span>
                <span
                  className={
                    item.variant === "base"
                      ? "font-semibold text-white"
                      : item.amount >= 0
                        ? "text-emerald-300"
                        : "text-rose-300"
                  }
                >
                  {item.variant === "base"
                    ? formatCurrency(item.amount, product.currency)
                    : formatCurrencyDelta(item.amount, product.currency)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-sm font-semibold text-white">
            <span>Estimated total</span>
            <span>{formatCurrency(selection.total, product.currency)}</span>
          </div>
        </aside>
      </section>

      <section className="grid gap-8 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h2 className="text-2xl font-semibold">How the engagement works</h2>
            <p className="mt-4 text-white/70">
              Every SMPLAT campaign pairs automation with expert oversight. We kick off with an onboarding diagnostic,
              define clear KPIs, and iterate through weekly test cycles while you retain full visibility in the client
              portal.
            </p>
            {marketing.benefits.length > 0 ? (
              <ul className="mt-6 space-y-3 text-white/70">
                {marketing.benefits.map((benefit) => (
                  <li key={benefit}>• {benefit}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {marketing.featureHighlights.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-3">
              {marketing.featureHighlights.map((feature) => (
                <div key={feature.title} className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                  <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                  <p className="mt-3 text-sm text-white/60">{feature.description}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <p className="text-sm uppercase tracking-wide text-white/60">Starting at</p>
            <p className="mt-2 text-3xl font-semibold">{formatCurrency(product.basePrice, product.currency)}</p>
            <p className="mt-4 text-sm text-white/60">
              Pricing adjusts based on selected campaign length, experimentation focus, and add-ons chosen above.
            </p>
            {visiblePricingExperiments.length > 0 ? (
              <div className="mt-4 space-y-4 rounded-2xl border border-dashed border-white/20 bg-black/30 p-4 text-xs text-white/70">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/60">Dynamic pricing lab</p>
                {visiblePricingExperiments.map((experiment) => (
                  <div key={experiment.slug} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{experiment.name}</p>
                      <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-white/60">
                        {experiment.status}
                      </span>
                    </div>
                    <p className="text-white/60">
                      Testing {experiment.variants.length} price points ({experiment.assignmentStrategy}) to inform PDP and checkout incentives.
                    </p>
                    <ul className="space-y-1 rounded-xl border border-white/10 bg-white/5 p-3 text-white">
                      {experiment.variants.map((variant) => (
                        <li key={`${experiment.slug}-${variant.key}`} className="flex items-center justify-between text-xs">
                          <span>
                            {variant.name}
                            {variant.isControl ? " · Control" : ""}
                          </span>
                          <span className="text-white/70">
                            {formatPricingExperimentAdjustment(variant, product.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="text-[11px] text-white/50">
                  Customers in enabled feature flags see live trial pricing. Operators can override assignments from the admin control hub.
                </p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/checkout?product=${product.slug}`}
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Start campaign
              </Link>
              <Link
                href="/#contact"
                className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
              >
                Book discovery call
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/70 backdrop-blur">
            <h3 className="text-lg font-semibold text-white">Campaign cadence</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <span className="font-semibold text-white">Day 0-1:</span> Onboarding, access provisioning, baseline analytics
              </li>
              <li>
                <span className="font-semibold text-white">Day 2-7:</span> Experiment design, creative brief, initial tests
              </li>
              <li>
                <span className="font-semibold text-white">Day 8-30:</span> Scale winners, iterate, and weekly syncs
              </li>
            </ul>
          </div>
        </aside>
      </section>

      {marketing.reviews.length > 0 ? (
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-white">Customer proof</h2>
              <p className="text-white/60">Hear from agencies and creators running on SMPLAT.</p>
            </div>
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-wide text-white/50">
              Verified testimonials
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {marketing.reviews.map((review) => (
              <div key={review.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{review.author}</p>
                  <span className="text-xs text-yellow-300">{renderStars(review.rating)}</span>
                </div>
                {review.role ? <p className="text-xs uppercase tracking-wide text-white/40">{review.role}</p> : null}
                <p className="mt-4 text-sm text-white/70">“{review.highlight}”</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

            {recommendations.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 to-white/5 p-8 backdrop-blur">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Dynamic bundle experiments</h2>
              <p className="text-sm text-white/60">
                Recommendations balance CMS priorities with live acceptance telemetry and operator readiness.
              </p>
            </div>
            <span className="rounded-full border border-emerald-400/60 px-3 py-1 text-xs uppercase tracking-wide text-emerald-200/80">
              {recommendations[0]?.provenance.cacheLayer.toUpperCase()}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {recommendations.map((bundle) => {
              const overlay = experimentOverlay.get(bundle.slug);
              const guardrailTriggered = hasGuardrailBreaches(overlay);
              const activeVariant = overlay?.find((variant) => !variant.isControl) ?? overlay?.[0];
              const acceptanceRate =
                activeVariant?.latestAcceptanceRate ?? bundle.acceptanceRate ?? null;
              const sampleSize = activeVariant?.latestSampleSize ?? bundle.acceptanceCount ?? null;

              return (
                <article
                  key={bundle.slug}
                  className={`rounded-2xl border bg-black/30 p-5 text-sm text-white/80 transition ${
                    guardrailTriggered ? "border-amber-400/60" : "border-white/15"
                  }`}
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-white">{bundle.title}</p>
                      {bundle.savingsCopy ? (
                        <span className="mt-1 inline-flex rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                          {bundle.savingsCopy}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                      Score {bundle.score.toFixed(1)}
                    </span>
                  </div>
                  {bundle.description ? <p className="mt-2 text-xs text-white/60">{bundle.description}</p> : null}
                  {overlay && overlay.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {overlay.map((variant) => (
                        <span
                          key={`${variant.experimentSlug}-${variant.variantKey}`}
                          className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wide ${
                            variant.guardrailBreached ? "bg-amber-500/20 text-amber-200" : "bg-white/10 text-white/70"
                          }`}
                        >
                          {variant.experimentName}: {variant.variantKey}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {bundle.components.map((component) => (
                      <Link
                        key={component}
                        href={`/products/${component}`}
                        className="inline-flex items-center rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white hover:text-white"
                      >
                        {component.replace(/-/g, " ")}
                      </Link>
                    ))}
                  </div>
                  <dl className="mt-4 grid gap-4 text-xs text-white/60 md:grid-cols-3">
                    <div>
                      <dt className="uppercase tracking-wide">Acceptance</dt>
                      <dd className="text-white">
                        {formatPercentage(acceptanceRate)}
                        {sampleSize !== null ? (
                          <span className="ml-2 text-xs text-white/60">n={sampleSize}</span>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide">Queue depth</dt>
                      <dd className="text-white">{formatQueueDepth(bundle.queueDepth)}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide">CMS priority</dt>
                      <dd className="text-white">{bundle.cmsPriority}</dd>
                    </div>
                  </dl>
                  {guardrailTriggered ? (
                    <p className="mt-3 text-xs text-amber-300">
                      Guardrail triggered — variants are throttled until telemetry stabilizes.
                    </p>
                  ) : null}
                  {bundle.notes.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {bundle.notes.map((note) => (
                        <span key={note} className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70">
                          {note.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {bundle.provenance.notes.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {bundle.provenance.notes.map((tag) => (
                        <span key={tag} className="rounded-full border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200/80">
                          {tag.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-4 text-[11px] text-white/50">
                    Last refreshed {bundle.provenance.cacheRefreshedAt.toLocaleString()} · Cache TTL {bundle.provenance.cacheTtlMinutes}m
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : recommendationFallback ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/70 backdrop-blur">
          {recommendationFallback}
        </section>
      ) : null}

      {experimentSummaries.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Experiment activity</h2>
              <p className="text-sm text-white/60">
                Guardrails auto-pause experiments when acceptance dips below thresholds.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {experimentSummaries.map((experiment) => (
              <article
                key={experiment.slug}
                className={`rounded-2xl border p-5 text-sm transition ${
                  experiment.guardrailTriggered
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
                    : "border-white/15 bg-black/20 text-white/70"
                }`}
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-base font-semibold text-white">{experiment.name}</p>
                    <p className="text-xs text-white/60">Slug: {experiment.slug} · Status: {experiment.status}</p>
                  </div>
                  {experiment.guardrailTriggered ? (
                    <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                      Guardrail active
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                      {experiment.status.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {experiment.variants.map((variant) => (
                    <div
                      key={`${experiment.slug}-${variant.key}`}
                      className={`rounded-xl border px-3 py-3 text-xs ${
                        variant.guardrailBreached
                          ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
                          : "border-white/15 bg-white/5 text-white/70"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{variant.name}</span>
                        <span className="uppercase tracking-wide text-white/60">
                          {variant.isControl ? "Control" : "Variant"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-white/60">
                        <span>Acceptance {formatPercentage(variant.acceptanceRate)}</span>
                        <span>n={variant.sampleSize ?? "–"}</span>
                        {variant.bundleSlug ? <span>Bundle {variant.bundleSlug}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

{marketing.bundles.length > 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-2xl font-semibold text-white">Bundle &amp; save</h2>
          <p className="mt-2 text-sm text-white/60">Pair this campaign with complementary services for multi-channel lift.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {marketing.bundles.map((bundle) => (
              <div key={bundle.slug} className="rounded-2xl border border-white/15 bg-white/5 p-5 text-sm text-white/70">
                <div className="flex items-center justify-between">
                  <p className="text-white">{bundle.title}</p>
                  {bundle.savings ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide text-emerald-300">
                      {bundle.savings}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2">{bundle.description}</p>
                <Link
                  href={`/products/${bundle.slug.split("+")[1] ?? bundle.slug}`}
                  className="mt-3 inline-flex text-xs font-semibold text-white/70 underline-offset-4 hover:text-white hover:underline"
                >
                  View complementary service →
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {marketing.faqs.length > 0 ? (
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">Frequently asked questions</h2>
            <p className="text-sm text-white/60">Need something specific? Our team is happy to walk you through details.</p>
          </div>
          <FaqAccordion
            items={marketing.faqs.map((faq) => ({
              question: faq.question,
              answer: faq.answer
            }))}
          />
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-10 backdrop-blur">
        <h2 className="text-2xl font-semibold text-white">Ready to accelerate your growth?</h2>
        <p className="mt-4 text-white/70">
          SMPLAT combines proven playbooks with automation and analytics to deliver measurable growth. Submit your order
          and we&apos;ll reach out within one business day to kick off your campaign.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/checkout?product=${product.slug}`}
            className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Proceed to checkout
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/70"
          >
            Talk to sales
          </Link>
        </div>
      </section>
    </main>
  );
}
