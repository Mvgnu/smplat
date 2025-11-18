"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { AssetGalleryManager } from "@/components/admin/assets/AssetGalleryManager";
import type { AssetDraft } from "@/components/admin/assets/types";
import { FieldValidationPanel } from "@/components/admin/fields/FieldValidationPanel";
import {
  ProductConfigurator,
  type ConfiguratorAddOn,
  type ConfiguratorCustomField,
  type ConfiguratorOptionGroup,
  type ConfiguratorPreset,
  type SubscriptionPlan as ConfiguratorSubscriptionPlan,
  buildAddOnMarginInsight,
  formatProviderCostSummary,
  formatMarginLabel
} from "@/components/products/product-configurator";
import { calculateAddOnDelta, getAddOnPricingInfo } from "@/lib/product-pricing";
import { FX_RATE_TABLE } from "@/lib/fx-rates";
import type { MarginStatus } from "@/lib/provider-service-insights";
import {
  describeCadence,
  describeCostModel,
  describeGuardrails,
  estimateProviderCost,
  evaluateMargin,
  formatCurrency as formatServiceCurrency,
  safePositiveNumber
} from "@/lib/provider-service-insights";
import type {
  CustomFieldVisibilityCondition,
  ProductAddOn,
  ProductAddOnMetadata,
  ProductConfigurationPreset,
  ProductCustomField,
  ProductCustomFieldMetadata,
  ProductOption,
  ProductOptionCalculatorMetadata,
  ProductOptionGroup,
  ProductOptionMetadata,
  ProductSubscriptionPlan,
  ServiceOverrideCondition,
  ServiceOverrideRule
} from "@/types/product";
import type { FulfillmentProvider, FulfillmentService } from "@/types/fulfillment";
import { uploadProductAssetAction } from "../merchandising/actions";
import { runJourneyComponentPreview } from "./journey-actions";
import type {
  CustomFieldDraft,
  CustomFieldVisibilityDraft,
  FieldVisibilityConditionDraft,
  FieldVisibilityConditionUpdate,
  JourneyComponentBindingDraft,
  JourneyComponentDraft,
} from "./types";
import type {
  JourneyComponentDefinition,
  JourneyComponentHealthSummary,
  JourneyComponentInputBinding,
  JourneyComponentRun,
  JourneyComponentRunStatus,
  JourneyComponentStage,
  ProductJourneyRuntime,
} from "@smplat/types";

export type ProductRecord = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  base_price?: number;
  basePrice?: number;
  currency?: string;
  status?: string;
  channelEligibility?: string[];
};

export type ProductJourneyComponentRecord = {
  id: string;
  componentId: string;
  displayOrder: number;
  channelEligibility?: string[] | null;
  isRequired?: boolean | null;
  bindings?: JourneyComponentInputBinding[];
  metadata?: Record<string, unknown> | null;
};

export type ProductDetailRecord = ProductRecord & {
  optionGroups?: ProductOptionGroup[];
  addOns?: ProductAddOn[];
  customFields?: ProductCustomField[];
  subscriptionPlans?: ProductSubscriptionPlan[];
  configurationPresets?: ProductConfigurationPreset[];
  journeyComponents?: ProductJourneyComponentRecord[];
};

type JourneyComponentHealthState = "healthy" | "warning" | "failing" | "pending";

type JourneyPreviewState = {
  status: "idle" | "running" | "success" | "error";
  message?: string;
  lastRunId?: string;
};

const JOURNEY_STAGE_FILTERS: { value: JourneyComponentStage | "all"; label: string }[] = [
  { value: "all", label: "All stages" },
  { value: "preset", label: "Preset" },
  { value: "checkout", label: "Checkout" },
  { value: "post_checkout", label: "Post-checkout" },
  { value: "operator", label: "Operator" },
  { value: "automation", label: "Automation" },
];

const JOURNEY_REGISTRY_RESULTS_LIMIT = 6;

type ProductsClientProps = {
  products: ProductRecord[];
  apiBase: string;
  csrfToken: string;
  initialProduct?: ProductDetailRecord | null;
  initialJourneyRuntime?: ProductJourneyRuntime | null;
};

type ProductDraft = {
  slug: string;
  title: string;
  category: string;
  description: string;
  basePrice: string;
  currency: string;
  status: "draft" | "active" | "archived";
  channelEligibility: string[];
};

type OptionDiscountTierDraft = {
  key: string;
  minAmount: string;
  unitPrice: string;
  label: string;
};

type OptionPricingDraft = {
  amount: string;
  amountUnit: string;
  basePrice: string;
  unitPrice: string;
  dripMinPerDay: string;
  discountTiers: OptionDiscountTierDraft[];
};

type OptionMediaDraft = {
  key: string;
  assetId: string;
  usage: string;
  label: string;
};

type OptionDraft = {
  key: string;
  label: string;
  description: string;
  priceDelta: string;
  recommended: boolean;
  marketingTagline: string;
  fulfillmentSla: string;
  heroImageUrl: string;
  calculatorExpression: string;
  calculatorSampleAmount: string;
  calculatorSampleDays: string;
  pricing: OptionPricingDraft;
  media: OptionMediaDraft[];
};

type OptionGroupDraft = {
  key: string;
  name: string;
  description: string;
  type: "single" | "multiple";
  required: boolean;
  options: OptionDraft[];
};

type AddOnPricingDraft = {
  mode: "flat" | "percentage" | "serviceOverride";
  amount: string;
  serviceId: string;
  providerId: string;
  costAmount: string;
  costCurrency: string;
  marginTarget: string;
  payloadTemplate: string;
  fulfillmentMode: "immediate" | "scheduled" | "refill";
  dripPerDay: string;
  previewQuantity: string;
  rules: ServiceRuleDraft[];
};

type ServiceRuleDraft = {
  key: string;
  label: string;
  description: string;
  priority: string;
  channels: string;
  regions: string;
  minAmount: string;
  maxAmount: string;
  minDrip: string;
  maxDrip: string;
  overrideServiceId: string;
  overrideProviderId: string;
  costAmount: string;
  costCurrency: string;
  marginTarget: string;
  fulfillmentMode: "immediate" | "scheduled" | "refill";
  dripPerDay: string;
  payloadTemplate: string;
  previewQuantity: string;
};

type ServiceRuleUpdater = <Key extends keyof ServiceRuleDraft>(
  addOnKey: string,
  ruleKey: string,
  key: Key,
  value: ServiceRuleDraft[Key],
) => void;

type AddOnDraft = {
  key: string;
  label: string;
  description: string;
  priceDelta: string;
  recommended: boolean;
  pricing: AddOnPricingDraft;
};

type SubscriptionPlanDraft = {
  key: string;
  label: string;
  description: string;
  billingCycle: "one_time" | "monthly" | "quarterly" | "annual";
  priceMultiplier: string;
  priceDelta: string;
  isDefault: boolean;
};

const toConfiguratorBillingCycle = (
  cycle: SubscriptionPlanDraft["billingCycle"]
): ConfiguratorSubscriptionPlan["billingCycle"] => (cycle === "one_time" ? "one-time" : cycle);

type OptionBlueprintPreview = {
  groupName: string;
  optionLabel: string;
  amount?: number;
  amountUnit?: string;
  basePrice?: number;
  unitPrice?: number;
  dripMinPerDay?: number | null;
  discountTiers?: Array<{
    minAmount: number;
    unitPrice: number;
    label?: string | null;
  }>;
  marketingTagline?: string;
  fulfillmentSla?: string;
  heroImageUrl?: string;
  heroSource?: "external" | "media";
  heroLabel?: string;
  calculatorExpression?: string;
  calculatorSampleAmount?: number | null;
  calculatorSampleDays?: number | null;
  calculatorSampleResult?: number | null;
  calculatorExpressionValid: boolean;
};

type FeedbackState = { type: "success" | "error"; message: string } | null;

const CHANNEL_OPTIONS = [
  { value: "storefront", label: "Storefront" },
  { value: "loyalty", label: "Loyalty" },
  { value: "referral", label: "Referral" },
  { value: "dashboard", label: "Client dashboard" }
];

const STATUS_OPTIONS: Array<{ value: ProductDraft["status"]; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Live" },
  { value: "archived", label: "Archived" }
];

const STATUS_BADGE_CLASSES: Record<ProductDraft["status"], string> = {
  draft: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  active: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  archived: "border-white/15 bg-white/5 text-white/60"
};

const RUNTIME_STATUS_STYLES: Record<
  JourneyComponentRunStatus,
  { border: string; text: string; label: string }
> = {
  pending: { border: "border-white/15", text: "text-white/60", label: "Pending" },
  queued: { border: "border-white/15", text: "text-white/60", label: "Queued" },
  running: { border: "border-amber-400/40", text: "text-amber-200", label: "Running" },
  succeeded: { border: "border-emerald-400/40", text: "text-emerald-200", label: "Succeeded" },
  failed: { border: "border-rose-400/40", text: "text-rose-200", label: "Failed" },
  cancelled: { border: "border-white/15", text: "text-white/50", label: "Cancelled" },
};

const RUNTIME_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const generateKey = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
};

const normalizeChannelToken = (token: string) => token.trim().toLowerCase();

const parseChannelEligibilityValue = (value: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map(normalizeChannelToken)
    .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
};

const normalizeChannelArray = (value: string[] | null | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeChannelToken)
    .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
};

const serializeChannelEligibility = (channels: string[]): string =>
  channels.length ? channels.join(", ") : "";

const createInitialDraft = (): ProductDraft => ({
  slug: "",
  title: "",
  category: "",
  description: "",
  basePrice: "",
  currency: "EUR",
  status: "draft",
  channelEligibility: ["storefront"]
});

const createInitialDiscountTier = (): OptionDiscountTierDraft => ({
  key: generateKey("tier"),
  minAmount: "",
  unitPrice: "",
  label: ""
});

const createInitialMediaAttachment = (): OptionMediaDraft => ({
  key: generateKey("media"),
  assetId: "",
  usage: "",
  label: ""
});

const createInitialOption = (): OptionDraft => ({
  key: generateKey("option"),
  label: "",
  description: "",
  priceDelta: "0",
  recommended: false,
  marketingTagline: "",
  fulfillmentSla: "",
  heroImageUrl: "",
  calculatorExpression: "",
  calculatorSampleAmount: "",
  calculatorSampleDays: "",
  pricing: {
    amount: "",
    amountUnit: "",
    basePrice: "",
    unitPrice: "",
    dripMinPerDay: "",
    discountTiers: []
  },
  media: []
});

const createInitialOptionGroup = (): OptionGroupDraft => ({
  key: generateKey("group"),
  name: "",
  description: "",
  type: "single",
  required: true,
  options: [
    {
      ...createInitialOption(),
      recommended: true
    }
  ]
});

const createCustomFieldDraft = (): CustomFieldDraft => ({
  key: generateKey("custom-field"),
  id: undefined,
  label: "",
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
    allowedValues: ""
  },
  sampleValues: "",
  defaultValue: "",
  exposeInCheckout: true,
  exposeInFulfillment: true,
  visibility: {
    mode: "all",
    conditions: []
  },
  regexTester: {
    sampleValue: "",
    lastResult: null
  }
});

const numberToString = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (Number.isNaN(value)) {
    return "";
  }
  return String(value);
};

const stringifyJson = (value: Record<string, unknown> | null | undefined): string => {
  if (!value) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

const hydrateOptionDraft = (option: ProductOption): OptionDraft => {
  const metadata = (option.metadataJson ?? (option as { metadata?: ProductOptionMetadata | null }).metadata ?? null) as
    | ProductOptionMetadata
    | null;
  const structured = metadata?.structuredPricing;
  const calculator = metadata?.calculator;
  const discountTiers =
    structured?.discountTiers
      ?.map<OptionDiscountTierDraft | null>((tier) => {
        if (!tier) {
          return null;
        }
        return {
          key: generateKey("tier"),
          minAmount: numberToString(tier.minAmount),
          unitPrice: numberToString(tier.unitPrice),
          label: tier.label ?? ""
        };
      })
      .filter((tier): tier is OptionDiscountTierDraft => tier != null) ?? [];
  const mediaDrafts =
    metadata?.media
      ?.map<OptionMediaDraft | null>((attachment) => {
        if (!attachment?.assetId) {
          return null;
        }
        return {
          key: generateKey("media"),
          assetId: attachment.assetId,
          usage: attachment.usage ?? "",
          label: attachment.label ?? ""
        };
      })
      .filter((attachment): attachment is OptionMediaDraft => attachment != null) ?? [];
  return {
    key: metadata?.editorKey ?? option.id ?? generateKey("option"),
    label: option.label ?? "",
    description: option.description ?? "",
    priceDelta: numberToString(option.priceDelta),
    recommended: Boolean(metadata?.recommended),
    marketingTagline: metadata?.marketingTagline ?? "",
    fulfillmentSla: metadata?.fulfillmentSla ?? "",
    heroImageUrl: metadata?.heroImageUrl ?? "",
    calculatorExpression: calculator?.expression ?? "",
    calculatorSampleAmount: numberToString(calculator?.sampleAmount),
    calculatorSampleDays: numberToString(calculator?.sampleDays),
    pricing: {
      amount: numberToString(structured?.amount),
      amountUnit: structured?.amountUnit ?? "",
      basePrice: numberToString(structured?.basePrice),
      unitPrice: numberToString(structured?.unitPrice),
      dripMinPerDay: numberToString(structured?.dripMinPerDay),
      discountTiers
    },
    media: mediaDrafts
  };
};

const hydrateOptionGroups = (groups?: ProductOptionGroup[]): OptionGroupDraft[] => {
  if (!groups?.length) {
    return [createInitialOptionGroup()];
  }
  return groups
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((group) => {
      const metadata = (group.metadataJson ?? (group as { metadata?: Record<string, unknown> | null }).metadata ??
        null) as { editorKey?: string } | null;
      const groupKey = metadata?.editorKey ?? group.id ?? generateKey("group");
      const hydratedOptions = (group.options ?? [])
        .slice()
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((option) => hydrateOptionDraft(option));
      return {
        key: groupKey,
        name: group.name ?? "",
        description: group.description ?? "",
        type: group.groupType === "multiple" ? "multiple" : "single",
        required: Boolean(group.isRequired),
        options: hydratedOptions.length > 0 ? hydratedOptions : [createInitialOption()]
      };
    });
};

const hydrateServiceRuleDrafts = (rules?: ServiceOverrideRule[]): ServiceRuleDraft[] => {
  if (!rules?.length) {
    return [];
  }
  return rules.map((rule) => {
    const channelCondition = rule.conditions.find(
      (condition) => condition.kind === "channel"
    ) as Extract<ServiceOverrideCondition, { kind: "channel" }> | undefined;
    const geoCondition = rule.conditions.find(
      (condition) => condition.kind === "geo"
    ) as Extract<ServiceOverrideCondition, { kind: "geo" }> | undefined;
    const amountCondition = rule.conditions.find(
      (condition) => condition.kind === "amount"
    ) as Extract<ServiceOverrideCondition, { kind: "amount" }> | undefined;
    const dripCondition = rule.conditions.find(
      (condition) => condition.kind === "drip"
    ) as Extract<ServiceOverrideCondition, { kind: "drip" }> | undefined;
    return {
      key: rule.id ?? generateKey("service-rule"),
      label: rule.label ?? "",
      description: rule.description ?? "",
      priority: numberToString(rule.priority),
      channels: channelCondition?.channels?.join(", ") ?? "",
      regions: geoCondition?.regions?.join(", ") ?? "",
      minAmount: numberToString(amountCondition?.min),
      maxAmount: numberToString(amountCondition?.max),
      minDrip: numberToString(dripCondition?.min),
      maxDrip: numberToString(dripCondition?.max),
      overrideServiceId: rule.overrides.serviceId ?? "",
      overrideProviderId: rule.overrides.providerId ?? "",
      costAmount: numberToString(rule.overrides.costAmount),
      costCurrency: rule.overrides.costCurrency ?? "",
      marginTarget: numberToString(rule.overrides.marginTarget),
      fulfillmentMode: rule.overrides.fulfillmentMode ?? "immediate",
      dripPerDay: numberToString(rule.overrides.dripPerDay),
      payloadTemplate: stringifyJson(rule.overrides.payloadTemplate ?? null),
      previewQuantity: numberToString(rule.overrides.previewQuantity)
    };
  });
};

const hydrateAddOnDrafts = (addOns?: ProductAddOn[]): AddOnDraft[] => {
  if (!addOns?.length) {
    return [];
  }
  return addOns
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((addOn) => {
      const metadata = (addOn.metadataJson ?? (addOn as { metadata?: ProductAddOnMetadata | null }).metadata ?? null) as
        | ProductAddOnMetadata
        | null;
      const pricing = metadata?.pricing;
      const mode = pricing?.mode ?? "flat";
      const serviceOverrideConfig =
        pricing && pricing.mode === "serviceOverride" ? pricing : undefined;
      return {
        key: metadata?.editorKey ?? addOn.id ?? generateKey("addon"),
        label: addOn.label ?? "",
        description: addOn.description ?? "",
        priceDelta: numberToString(addOn.priceDelta),
        recommended: Boolean(addOn.isRecommended),
        pricing: {
          mode,
          amount: numberToString(pricing?.amount),
          serviceId: serviceOverrideConfig?.serviceId ?? "",
          providerId: serviceOverrideConfig?.providerId ?? "",
          costAmount: numberToString(serviceOverrideConfig?.costAmount),
          costCurrency: serviceOverrideConfig?.costCurrency ?? "",
          marginTarget: numberToString(serviceOverrideConfig?.marginTarget),
          payloadTemplate: stringifyJson(serviceOverrideConfig?.payloadTemplate ?? null),
          fulfillmentMode: serviceOverrideConfig?.fulfillmentMode ?? "immediate",
          dripPerDay: numberToString(serviceOverrideConfig?.dripPerDay),
          previewQuantity: numberToString(serviceOverrideConfig?.previewQuantity),
          rules: hydrateServiceRuleDrafts(serviceOverrideConfig?.rules)
        }
      };
    });
};

const hydrateSubscriptionPlanDrafts = (plans?: ProductSubscriptionPlan[]): SubscriptionPlanDraft[] => {
  if (!plans?.length) {
    return [];
  }
  return plans
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((plan) => ({
      key: plan.id ?? generateKey("plan"),
      label: plan.label ?? "",
      description: plan.description ?? "",
      billingCycle: (plan.billingCycle ?? "one_time") as SubscriptionPlanDraft["billingCycle"],
      priceMultiplier: numberToString(plan.priceMultiplier),
      priceDelta: numberToString(plan.priceDelta),
      isDefault: Boolean(plan.isDefault)
    }));
};

const deserializeVisibilityDraft = (
  visibility: ProductCustomFieldMetadata["conditionalVisibility"] | null | undefined,
  optionGroups: OptionGroupDraft[],
  addOns: AddOnDraft[],
  subscriptionPlans: SubscriptionPlanDraft[]
): CustomFieldVisibilityDraft => {
  if (!visibility || !Array.isArray(visibility.conditions) || visibility.conditions.length === 0) {
    return {
      mode: "all",
      conditions: []
    };
  }
  const optionGroupLookup = new Map<string, string>();
  optionGroups.forEach((group) => {
    group.options.forEach((option) => {
      optionGroupLookup.set(option.key, group.key);
    });
  });
  const conditions: FieldVisibilityConditionDraft[] = visibility.conditions
    .map<FieldVisibilityConditionDraft | null>((condition) => {
      if (condition.kind === "option") {
        if (!condition.optionKey) {
          return null;
        }
        const groupKey =
          condition.groupKey ?? optionGroupLookup.get(condition.optionKey) ?? optionGroups[0]?.key ?? "";
        if (!groupKey) {
          return null;
        }
        return {
          key: generateKey("field-visibility"),
          kind: "option",
          groupKey,
          optionKey: condition.optionKey
        };
      }
      if (condition.kind === "addOn") {
        const addOnKey = condition.addOnKey ?? addOns[0]?.key;
        if (!addOnKey) {
          return null;
        }
        return {
          key: generateKey("field-visibility"),
          kind: "addOn",
          addOnKey
        };
      }
      if (condition.kind === "subscriptionPlan") {
        const planKey = condition.planKey ?? subscriptionPlans[0]?.key;
        if (!planKey) {
          return null;
        }
        return {
          key: generateKey("field-visibility"),
          kind: "subscriptionPlan",
          planKey
        };
      }
      if (condition.kind === "channel") {
        const channel = condition.channel?.trim();
        if (!channel) {
          return null;
        }
        return {
          key: generateKey("field-visibility"),
          kind: "channel",
          channel
        };
      }
      return null;
    })
    .filter((condition): condition is FieldVisibilityConditionDraft => condition != null);
  return {
    mode: visibility.mode ?? "all",
    conditions
  };
};

const hydrateCustomFieldDrafts = (
  fields: ProductCustomField[] | undefined,
  optionGroups: OptionGroupDraft[],
  addOns: AddOnDraft[],
  subscriptionPlans: SubscriptionPlanDraft[]
): CustomFieldDraft[] => {
  if (!fields?.length) {
    return [];
  }
  return fields
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((field) => {
      const metadata = (field.metadataJson ??
        (field as { metadata?: ProductCustomFieldMetadata | null }).metadata ??
        null) as ProductCustomFieldMetadata | null;
      const validationSource =
        metadata?.validation ?? field.validationRules ?? field.validation ?? ({} as ProductCustomFieldMetadata["validation"]);
      const visibility = deserializeVisibilityDraft(metadata?.conditionalVisibility, optionGroups, addOns, subscriptionPlans);
      const sampleValues = metadata?.sampleValues ?? [];
      const regexTesterMetadata = metadata?.regexTester;
      const passthrough = metadata?.passthrough ?? field.passthroughTargets ?? {};
      const draft = createCustomFieldDraft();
      const allowedValuesString =
        validationSource && Array.isArray(validationSource.allowedValues)
          ? validationSource.allowedValues.join("\n")
          : "";
      return {
        ...draft,
        key: metadata?.editorKey ?? field.id ?? generateKey("custom-field"),
        id: field.id,
        label: field.label ?? "",
        fieldType: field.fieldType ?? "text",
        placeholder: field.placeholder ?? "",
        helpText: field.helpText ?? "",
        required: Boolean(field.isRequired),
        validation: {
          ...draft.validation,
          minLength: numberToString(validationSource?.minLength),
          maxLength: numberToString(validationSource?.maxLength),
          pattern: validationSource?.pattern ?? "",
          regexFlags: validationSource?.regex?.flags ?? "",
          regexDescription: validationSource?.regex?.description ?? "",
          disallowWhitespace: Boolean(validationSource?.disallowWhitespace),
          minValue: numberToString(validationSource?.minValue),
          maxValue: numberToString(validationSource?.maxValue),
          numericStep: numberToString(validationSource?.numericStep),
          allowedValues: allowedValuesString
        },
        sampleValues: sampleValues.length > 0 ? sampleValues.join("\n") : "",
        defaultValue: metadata?.defaultValue ?? field.defaultValue ?? "",
        exposeInCheckout: passthrough?.checkout ?? true,
        exposeInFulfillment: passthrough?.fulfillment ?? true,
        visibility,
        regexTester: {
          sampleValue: regexTesterMetadata?.sampleValue ?? "",
          lastResult:
            typeof regexTesterMetadata?.lastResult === "boolean" ? regexTesterMetadata.lastResult : null
        }
      };
    });
};

const hydrateJourneyComponents = (
  assignments?: ProductJourneyComponentRecord[]
): JourneyComponentDraft[] => {
  if (!assignments?.length) {
    return [];
  }
  return assignments
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((assignment, index) => {
      const resolvedOrder = Number.isFinite(assignment.displayOrder) ? assignment.displayOrder : index;
      const bindings =
        assignment.bindings && assignment.bindings.length > 0
          ? assignment.bindings.map((binding) => hydrateJourneyBindingDraft(binding))
          : [createJourneyBindingDraft()];
      const metadataJson =
        assignment.metadata && Object.keys(assignment.metadata).length > 0
          ? stringifyJson(assignment.metadata as Record<string, unknown>)
          : "";
      return {
        key: generateKey("journey"),
        id: assignment.id,
        componentId: assignment.componentId ?? "",
        displayOrder: String(resolvedOrder),
        channelEligibility: serializeChannelEligibility(normalizeChannelArray(assignment.channelEligibility)),
        isRequired: Boolean(assignment.isRequired),
        bindings,
        metadataJson
      };
    });
};

const parseJourneyMetadataDraft = (value: string): Record<string, unknown> | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const hydrateProductDraft = (product: ProductDetailRecord): ProductDraft => {
  const basePriceValue = product.basePrice ?? product.base_price;
  const normalizedStatus = typeof product.status === "string" ? product.status.toLowerCase() : "draft";
  const statusMatch = STATUS_OPTIONS.find((option) => option.value === normalizedStatus);
  return {
    slug: product.slug ?? "",
    title: product.title ?? "",
    category: product.category ?? "",
    description: product.description ?? "",
    basePrice: basePriceValue != null ? String(basePriceValue) : "",
    currency: product.currency ?? "EUR",
    status: (statusMatch?.value ?? "draft") as ProductDraft["status"],
    channelEligibility: normalizeChannelArray(
      product.channelEligibility ??
        (product as { channel_eligibility?: string[] }).channel_eligibility ??
        []
    )
  };
};

const createInitialAddOnDraft = (): AddOnDraft => ({
  key: generateKey("addon"),
  label: "",
  description: "",
  priceDelta: "0",
  recommended: false,
  pricing: {
    mode: "flat",
    amount: "",
    serviceId: "",
    providerId: "",
    costAmount: "",
    costCurrency: "",
    marginTarget: "",
    payloadTemplate: "",
    fulfillmentMode: "immediate",
    dripPerDay: "",
    previewQuantity: "",
    rules: []
  }
});

const createServiceRuleDraft = (): ServiceRuleDraft => ({
  key: generateKey("rule"),
  label: "",
  description: "",
  priority: "",
  channels: "",
  regions: "",
  minAmount: "",
  maxAmount: "",
  minDrip: "",
  maxDrip: "",
  overrideServiceId: "",
  overrideProviderId: "",
  costAmount: "",
  costCurrency: "",
  marginTarget: "",
  fulfillmentMode: "immediate",
  dripPerDay: "",
  payloadTemplate: "",
  previewQuantity: "",
});

const createJourneyBindingDraft = (
  kind: JourneyComponentBindingDraft["kind"] = "static"
): JourneyComponentBindingDraft => {
  const key = generateKey("journey-binding");
  switch (kind) {
    case "product_field":
      return {
        key,
        kind,
        inputKey: "",
        path: "",
        required: false,
      };
    case "runtime":
      return {
        key,
        kind,
        inputKey: "",
        source: "",
        required: false,
      };
    case "static":
    default:
      return {
        key,
        kind: "static",
        inputKey: "",
        value: "",
      };
  }
};

const hydrateJourneyBindingDraft = (binding: JourneyComponentInputBinding): JourneyComponentBindingDraft => {
  const key = generateKey("journey-binding");
  if (binding.kind === "static") {
    return {
      key,
      kind: "static",
      inputKey: binding.inputKey ?? "",
      value: binding.value == null ? "" : String(binding.value),
    };
  }
  if (binding.kind === "product_field") {
    return {
      key,
      kind: "product_field",
      inputKey: binding.inputKey ?? "",
      path: binding.path ?? "",
      required: Boolean(binding.required),
    };
  }
  return {
    key,
    kind: "runtime",
    inputKey: binding.inputKey ?? "",
    source: binding.source ?? "",
    required: Boolean(binding.required),
  };
};

const createJourneyComponentDraft = (
  componentId = "",
  displayOrder?: number,
  productComponentId?: string | null
): JourneyComponentDraft => ({
  key: generateKey("journey"),
  id: productComponentId ?? null,
  componentId,
  displayOrder: displayOrder != null ? String(displayOrder) : "",
  channelEligibility: "",
  isRequired: false,
  bindings: [createJourneyBindingDraft()],
  metadataJson: "",
});

const createInitialPlan = (): SubscriptionPlanDraft => ({
  key: generateKey("plan"),
  label: "",
  description: "",
  billingCycle: "one_time",
  priceMultiplier: "",
  priceDelta: "",
  isDefault: false
});

const resolveStatusLabel = (status?: string) => {
  if (!status) {
    return STATUS_OPTIONS[0]?.label ?? "Draft";
  }
  const normalized = status.toLowerCase() as ProductDraft["status"];
  const match = STATUS_OPTIONS.find((option) => option.value === normalized);
  return match?.label ?? status;
};

function formatPrice(currency: string | undefined, value: number | undefined) {
  const resolvedCurrency = currency ?? "EUR";
  const resolvedValue = value ?? 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: resolvedCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(resolvedValue);
}

const isCalculatorExpressionValid = (expression: string): boolean => {
  if (expression.trim().length === 0) {
    return true;
  }
  const sanitized = expression
    .replace(/\bamount\b/gi, "")
    .replace(/\bdays\b/gi, "")
    .replace(/[0-9+\-*/().\s]/g, "");
  return sanitized.trim().length === 0;
};

const evaluateCalculatorExpression = (
  expression: string,
  amount: number | null | undefined,
  days: number | null | undefined
): number | null => {
  if (!expression || !isCalculatorExpressionValid(expression)) {
    return null;
  }
  try {
    const fn = Function("amount", "days", `return ${expression};`) as (amount: number, days: number) => unknown;
    const safeAmount = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
    const safeDays = typeof days === "number" && Number.isFinite(days) ? days : 0;
    const result = fn(safeAmount, safeDays);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

export function ProductsClient({
  products,
  apiBase,
  csrfToken,
  initialProduct,
  initialJourneyRuntime,
}: ProductsClientProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProductDraft>(() => createInitialDraft());
  const [previewChannel, setPreviewChannel] = useState<string>(
    () => draft.channelEligibility[0] ?? CHANNEL_OPTIONS[0]?.value ?? "storefront",
  );
  const [optionGroups, setOptionGroups] = useState<OptionGroupDraft[]>([createInitialOptionGroup()]);
  const [addOns, setAddOns] = useState<AddOnDraft[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlanDraft[]>([]);
  const [journeyComponents, setJourneyComponents] = useState<JourneyComponentDraft[]>([]);
  const [journeyPreviewStates, setJourneyPreviewStates] = useState<Record<string, JourneyPreviewState>>({});
  const [assetDrafts, setAssetDrafts] = useState<AssetDraft[]>([]);
  const assetDraftsRef = useRef<AssetDraft[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<FulfillmentProvider[]>([]);
  const [journeyCatalog, setJourneyCatalog] = useState<JourneyComponentDefinition[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [isLoadingJourneyCatalog, setIsLoadingJourneyCatalog] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploadingAssets, setIsUploadingAssets] = useState(false);
  const [channelInputDrafts, setChannelInputDrafts] = useState<Record<string, string>>({});
  const [journeyRuntime, setJourneyRuntime] = useState<ProductJourneyRuntime | null>(
    initialJourneyRuntime ?? null,
  );
  const [isRefreshingJourneyRuntime, setIsRefreshingJourneyRuntime] = useState(false);
  const [journeyAssignmentQuery, setJourneyAssignmentQuery] = useState("");
  const [journeyAssignmentStage, setJourneyAssignmentStage] = useState<JourneyComponentStage | "all">(
    "all",
  );
  const [journeyRegistryQuery, setJourneyRegistryQuery] = useState("");
  const [journeyRegistryStage, setJourneyRegistryStage] = useState<JourneyComponentStage | "all">("all");

  useEffect(() => {
    assetDraftsRef.current = assetDrafts;
  }, [assetDrafts]);

  useEffect(
    () => () => {
      assetDraftsRef.current.forEach((asset) => {
        if (asset.previewUrl) {
          URL.revokeObjectURL(asset.previewUrl);
        }
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    async function loadProviders() {
      setIsLoadingProviders(true);
      try {
        const response = await fetch(`${apiBase}/api/v1/fulfillment/providers`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as { providers?: FulfillmentProvider[] } | FulfillmentProvider[];
        const providersList = Array.isArray(payload) ? payload : payload.providers ?? [];
        if (!cancelled) {
          setProviderCatalog(providersList);
        }
      } catch (error) {
        console.warn("Failed to load provider catalog", error);
        if (!cancelled) {
          setProviderCatalog([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProviders(false);
        }
      }
    }
    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    async function loadJourneyComponents() {
      setIsLoadingJourneyCatalog(true);
      try {
        const response = await fetch(`${apiBase}/api/v1/journey-components`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as JourneyComponentDefinition[];
        if (!cancelled) {
          setJourneyCatalog(payload);
        }
      } catch (error) {
        console.warn("Failed to load journey components", error);
        if (!cancelled) {
          setJourneyCatalog([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingJourneyCatalog(false);
        }
      }
    }
    void loadJourneyComponents();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!initialProduct) {
      setDraft(createInitialDraft());
      setOptionGroups([createInitialOptionGroup()]);
      setAddOns([]);
      setCustomFields([]);
      setSubscriptionPlans([]);
      setJourneyComponents([]);
      setChannelInputDrafts({});
      assetDraftsRef.current.forEach((asset) => {
        if (asset.previewUrl) {
          URL.revokeObjectURL(asset.previewUrl);
        }
      });
      setAssetDrafts([]);
      return;
    }
    const hydratedDraft = hydrateProductDraft(initialProduct);
    const hydratedOptionGroups = hydrateOptionGroups(initialProduct.optionGroups);
    const hydratedAddOns = hydrateAddOnDrafts(initialProduct.addOns);
    const hydratedSubscriptionPlans = hydrateSubscriptionPlanDrafts(initialProduct.subscriptionPlans);
    const hydratedCustomFields = hydrateCustomFieldDrafts(
      initialProduct.customFields,
      hydratedOptionGroups,
      hydratedAddOns,
      hydratedSubscriptionPlans
    );
    const hydratedJourneyComponents = hydrateJourneyComponents(initialProduct.journeyComponents);
    setDraft(hydratedDraft);
    setOptionGroups(hydratedOptionGroups.length > 0 ? hydratedOptionGroups : [createInitialOptionGroup()]);
    setAddOns(hydratedAddOns);
    setCustomFields(hydratedCustomFields);
    setSubscriptionPlans(hydratedSubscriptionPlans);
    setJourneyComponents(hydratedJourneyComponents);
    setChannelInputDrafts({});
    assetDraftsRef.current.forEach((asset) => {
      if (asset.previewUrl) {
        URL.revokeObjectURL(asset.previewUrl);
      }
    });
    setAssetDrafts([]);
  }, [initialProduct]);

  useEffect(() => {
    setJourneyRuntime(initialJourneyRuntime ?? null);
  }, [initialJourneyRuntime]);

  const updateDraft = <Key extends keyof ProductDraft>(key: Key, value: ProductDraft[Key]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  useEffect(() => {
    if (draft.channelEligibility.length === 0) {
      return;
    }
    if (!draft.channelEligibility.includes(previewChannel)) {
      setPreviewChannel(draft.channelEligibility[0]);
    }
  }, [draft.channelEligibility, previewChannel]);

  const handleChannelToggle = (channel: string) => {
    setDraft((previous) => {
      const normalized = channel.toLowerCase();
      const hasChannel = previous.channelEligibility.includes(normalized);
      const nextChannels = hasChannel
        ? previous.channelEligibility.filter((value) => value !== normalized)
        : [...previous.channelEligibility, normalized];
      nextChannels.sort((a, b) => a.localeCompare(b));
      return { ...previous, channelEligibility: nextChannels };
    });
  };

  const normalizedProducts = useMemo(() => {
    return products.map((product) => {
      const channels =
        product.channelEligibility ??
        (product as { channel_eligibility?: string[] }).channel_eligibility ??
        [];
      return { ...product, channelEligibility: channels };
    });
  }, [products]);

  const journeyComponentLookup = useMemo(() => {
    const map = new Map<string, JourneyComponentDefinition>();
    journeyCatalog.forEach((component) => map.set(component.id, component));
    return map;
  }, [journeyCatalog]);

  const journeyComponentHealthMap = useMemo(
    () => buildJourneyComponentHealthMap(journeyRuntime),
    [journeyRuntime],
  );

  const filteredJourneyComponents = useMemo(() => {
    const normalizedQuery = journeyAssignmentQuery.trim().toLowerCase();
    if (!normalizedQuery && journeyAssignmentStage === "all") {
      return journeyComponents;
    }
    return journeyComponents.filter((component) => {
      const definition = journeyComponentLookup.get(component.componentId);
      const matchesStage =
        journeyAssignmentStage === "all" ||
        (definition?.triggers ?? []).some((trigger) => trigger.stage === journeyAssignmentStage);
      if (!matchesStage) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack: string[] = [
        component.componentId,
        component.channelEligibility,
        component.metadataJson,
        definition?.name ?? "",
        definition?.description ?? "",
        definition?.scriptSlug ?? "",
      ];
      if (definition?.tags?.length) {
        haystack.push(definition.tags.join(" "));
      }
      if (definition?.triggers?.length) {
        haystack.push(
          definition.triggers.map((trigger) => `${trigger.stage}:${trigger.event}`).join(" "),
        );
      }
      return haystack.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [journeyComponents, journeyAssignmentQuery, journeyAssignmentStage, journeyComponentLookup]);

  const hasActiveJourneyAssignmentFilters =
    journeyAssignmentQuery.trim().length > 0 || journeyAssignmentStage !== "all";

  const filteredJourneyCatalog = useMemo(() => {
    const normalizedQuery = journeyRegistryQuery.trim().toLowerCase();
    return journeyCatalog.filter((definition) => {
      const matchesStage =
        journeyRegistryStage === "all" ||
        (definition.triggers ?? []).some((trigger) => trigger.stage === journeyRegistryStage);
      if (!matchesStage) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack: string[] = [
        definition.name,
        definition.description ?? "",
        definition.scriptSlug ?? "",
      ];
      if (definition.tags?.length) {
        haystack.push(definition.tags.join(" "));
      }
      if (definition.triggers?.length) {
        haystack.push(
          definition.triggers.map((trigger) => `${trigger.stage}:${trigger.event}`).join(" "),
        );
      }
      return haystack.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [journeyCatalog, journeyRegistryQuery, journeyRegistryStage]);

  const journeyRegistryResults = useMemo(
    () => filteredJourneyCatalog.slice(0, JOURNEY_REGISTRY_RESULTS_LIMIT),
    [filteredJourneyCatalog],
  );
  const hasMoreJourneyRegistryResults =
    filteredJourneyCatalog.length > JOURNEY_REGISTRY_RESULTS_LIMIT;

  const hasExistingProduct = Boolean(initialProduct);
  const activeProductId = initialProduct?.id ?? null;

  useEffect(() => {
    setJourneyAssignmentQuery("");
    setJourneyAssignmentStage("all");
  }, [activeProductId]);

  const refreshJourneyRuntime = useCallback(async () => {
    if (!activeProductId) {
      return;
    }
    setIsRefreshingJourneyRuntime(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/products/${activeProductId}/journeys`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as ProductJourneyRuntime;
      setJourneyRuntime(payload);
    } catch (error) {
      console.warn("Failed to refresh journey runtime", error);
    } finally {
      setIsRefreshingJourneyRuntime(false);
    }
  }, [apiBase, activeProductId]);

  const handleJourneyPreviewRun = useCallback(
    async (component: JourneyComponentDraft) => {
      if (!hasExistingProduct || !activeProductId || !component.componentId || !component.id) {
        return;
      }
      setJourneyPreviewStates((previous) => ({
        ...previous,
        [component.key]: { status: "running" },
      }));
      try {
        const metadata = parseJourneyMetadataDraft(component.metadataJson);
        const channels = parseChannelEligibilityValue(component.channelEligibility);
        const result = await runJourneyComponentPreview({
          productId: activeProductId,
          productComponentId: component.id,
          componentId: component.componentId,
          channel: channels[0] ?? "admin_preview",
          metadata,
          csrfToken,
        });
        setJourneyPreviewStates((previous) => ({
          ...previous,
          [component.key]: { status: "success", lastRunId: result.run.id },
        }));
        await refreshJourneyRuntime();
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "Unable to queue preview run.";
        setJourneyPreviewStates((previous) => ({
          ...previous,
          [component.key]: { status: "error", message },
        }));
      }
    },
    [activeProductId, csrfToken, hasExistingProduct, refreshJourneyRuntime],
  );

  const handleAddJourneyComponent = () => {
    setJourneyComponents((previous) => [
      ...previous,
      createJourneyComponentDraft(journeyCatalog[0]?.id ?? "", previous.length),
    ]);
  };

  const handleAttachJourneyFromRegistry = (componentId: string) => {
    if (!componentId) {
      return;
    }
    setJourneyComponents((previous) => [
      ...previous,
      createJourneyComponentDraft(componentId, previous.length),
    ]);
  };

  const handleRemoveJourneyComponent = (componentKey: string) => {
    setJourneyComponents((previous) => previous.filter((entry) => entry.key !== componentKey));
    setChannelInputDrafts((previous) => {
      if (!(componentKey in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[componentKey];
      return next;
    });
  };

  const moveJourneyComponent = (componentKey: string, direction: "up" | "down") => {
    setJourneyComponents((previous) => {
      const index = previous.findIndex((entry) => entry.key === componentKey);
      if (index === -1) {
        return previous;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [removed] = next.splice(index, 1);
      next.splice(targetIndex, 0, removed);
      return next.map((entry, idx) => ({
        ...entry,
        displayOrder: String(idx),
      }));
    });
  };

  const applyJourneyChannels = (componentKey: string, channels: string[]) => {
    if (channels.length === 0) {
      return;
    }
    setJourneyComponents((previous) =>
      previous.map((entry) => {
        if (entry.key !== componentKey) {
          return entry;
        }
        const current = parseChannelEligibilityValue(entry.channelEligibility);
        const merged = [...current];
        channels.forEach((channel) => {
          const normalized = normalizeChannelToken(channel);
          if (normalized && !merged.includes(normalized)) {
            merged.push(normalized);
          }
        });
        if (merged.length === current.length) {
          return entry;
        }
        return {
          ...entry,
          channelEligibility: serializeChannelEligibility(merged),
        };
      }),
    );
  };

  const handleChannelInputChange = (componentKey: string, value: string) => {
    setChannelInputDrafts((previous) => ({ ...previous, [componentKey]: value }));
  };

  const handleChannelInputKeyDown = (componentKey: string, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitChannelDraft(componentKey);
    } else if (event.key === ",") {
      event.preventDefault();
      commitChannelDraft(componentKey);
    }
  };

  const commitChannelDraft = (componentKey: string) => {
    const pending = channelInputDrafts[componentKey];
    if (!pending) {
      return;
    }
    const tokens = parseChannelEligibilityValue(pending);
    applyJourneyChannels(componentKey, tokens);
    setChannelInputDrafts((previous) => ({ ...previous, [componentKey]: "" }));
  };

  const removeJourneyChannel = (componentKey: string, channel: string) => {
    const normalized = normalizeChannelToken(channel);
    if (!normalized) {
      return;
    }
    setJourneyComponents((previous) =>
      previous.map((entry) => {
        if (entry.key !== componentKey) {
          return entry;
        }
        const current = parseChannelEligibilityValue(entry.channelEligibility);
        const nextChannels = current.filter((value) => value !== normalized);
        if (nextChannels.length === current.length) {
          return entry;
        }
        return {
          ...entry,
          channelEligibility: serializeChannelEligibility(nextChannels),
        };
      }),
    );
  };

  const updateJourneyComponent = <Key extends keyof JourneyComponentDraft>(
    componentKey: string,
    field: Key,
    value: JourneyComponentDraft[Key],
  ) => {
    setJourneyComponents((previous) =>
      previous.map((entry) => {
        if (entry.key !== componentKey) {
          return entry;
        }
        if (field === "componentId") {
          const nextEntry: JourneyComponentDraft = {
            ...entry,
            componentId: value as JourneyComponentDraft["componentId"],
          };
          if (entry.id) {
            nextEntry.id = null;
          }
          return nextEntry;
        }
        return { ...entry, [field]: value };
      })
    );
  };

  const addJourneyComponentBinding = (
    componentKey: string,
    kind: JourneyComponentBindingDraft["kind"] = "static",
  ) => {
    setJourneyComponents((previous) =>
      previous.map((entry) =>
        entry.key === componentKey
          ? { ...entry, bindings: [...entry.bindings, createJourneyBindingDraft(kind)] }
          : entry
      )
    );
  };

  const removeJourneyComponentBinding = (componentKey: string, bindingKey: string) => {
    setJourneyComponents((previous) =>
      previous.map((entry) =>
        entry.key === componentKey
          ? { ...entry, bindings: entry.bindings.filter((binding) => binding.key !== bindingKey) }
          : entry
      )
    );
  };

  const changeJourneyBindingKind = (
    componentKey: string,
    bindingKey: string,
    nextKind: JourneyComponentBindingDraft["kind"],
  ) => {
    setJourneyComponents((previous) =>
      previous.map((entry) => {
        if (entry.key !== componentKey) {
          return entry;
        }
        return {
          ...entry,
          bindings: entry.bindings.map((binding) => {
            if (binding.key !== bindingKey) {
              return binding;
            }
            if (binding.kind === nextKind) {
              return binding;
            }
            const nextBinding = createJourneyBindingDraft(nextKind);
            return {
              ...nextBinding,
              key: binding.key,
              inputKey: binding.inputKey,
            };
          }),
        };
      })
    );
  };

  const updateJourneyBinding = (
    componentKey: string,
    bindingKey: string,
    patch: Partial<JourneyComponentBindingDraft>,
  ) => {
    setJourneyComponents((previous) =>
      previous.map((entry) => {
        if (entry.key !== componentKey) {
          return entry;
        }
        return {
          ...entry,
          bindings: entry.bindings.map((binding) =>
            binding.key === bindingKey
              ? ({ ...binding, ...patch } as JourneyComponentBindingDraft)
              : binding
          ),
        };
      })
    );
  };

  const handleAddGroup = () => {
    setOptionGroups((previous) => [...previous, createInitialOptionGroup()]);
  };

  const handleRemoveGroup = (key: string) => {
    setOptionGroups((previous) => (previous.length > 1 ? previous.filter((group) => group.key !== key) : previous));
  };

  const updateGroup = <Key extends keyof OptionGroupDraft>(groupKey: string, key: Key, value: OptionGroupDraft[Key]) => {
    setOptionGroups((previous) =>
      previous.map((group) => (group.key === groupKey ? { ...group, [key]: value } : group))
    );
  };

  const handleAddOption = (groupKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) =>
        group.key === groupKey
          ? {
              ...group,
              options: [...group.options, createInitialOption()]
            }
          : group
      )
    );
  };

  const handleRemoveOption = (groupKey: string, optionKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        const filtered = group.options.filter((option) => option.key !== optionKey);
        return {
          ...group,
          options: filtered.length > 0 ? filtered : [createInitialOption()]
        };
      })
    );
  };

  const updateOption = <Key extends keyof OptionDraft>(
    groupKey: string,
    optionKey: string,
    key: Key,
    value: OptionDraft[Key]
  ) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) => (option.key === optionKey ? { ...option, [key]: value } : option))
        };
      })
    );
  };

  const addDiscountTier = (groupKey: string, optionKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  pricing: {
                    ...option.pricing,
                    discountTiers: [...option.pricing.discountTiers, createInitialDiscountTier()]
                  }
                }
              : option
          )
        };
      })
    );
  };

  const updateDiscountTier = <Key extends keyof OptionDiscountTierDraft>(
    groupKey: string,
    optionKey: string,
    tierKey: string,
    key: Key,
    value: OptionDiscountTierDraft[Key]
  ) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  pricing: {
                    ...option.pricing,
                    discountTiers: option.pricing.discountTiers.map((tier) =>
                      tier.key === tierKey ? { ...tier, [key]: value } : tier
                    )
                  }
                }
              : option
          )
        };
      })
    );
  };

  const removeDiscountTier = (groupKey: string, optionKey: string, tierKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  pricing: {
                    ...option.pricing,
                    discountTiers: option.pricing.discountTiers.filter((tier) => tier.key !== tierKey)
                  }
                }
              : option
          )
        };
      })
    );
  };

  const addOptionMedia = (groupKey: string, optionKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  media: [...option.media, createInitialMediaAttachment()]
                }
              : option
          )
        };
      })
    );
  };

  const updateOptionMedia = <Key extends keyof OptionMediaDraft>(
    groupKey: string,
    optionKey: string,
    mediaKey: string,
    key: Key,
    value: OptionMediaDraft[Key]
  ) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  media: option.media.map((attachment) =>
                    attachment.key === mediaKey ? { ...attachment, [key]: value } : attachment
                  )
                }
              : option
          )
        };
      })
    );
  };

  const removeOptionMedia = (groupKey: string, optionKey: string, mediaKey: string) => {
    setOptionGroups((previous) =>
      previous.map((group) => {
        if (group.key !== groupKey) {
          return group;
        }
        return {
          ...group,
          options: group.options.map((option) =>
            option.key === optionKey
              ? {
                  ...option,
                  media: option.media.filter((attachment) => attachment.key !== mediaKey)
                }
              : option
          )
        };
      })
    );
  };

  const handleAddOn = () => {
    setAddOns((previous) => [...previous, createInitialAddOnDraft()]);
  };

  const updateAddOn = <Key extends keyof AddOnDraft>(itemKey: string, key: Key, value: AddOnDraft[Key]) => {
    setAddOns((previous) => previous.map((item) => (item.key === itemKey ? { ...item, [key]: value } : item)));
  };

  const updateAddOnPricing = (itemKey: string, partial: Partial<AddOnPricingDraft>) => {
    setAddOns((previous) =>
      previous.map((item) =>
        item.key === itemKey
          ? { ...item, pricing: { ...item.pricing, ...partial } }
          : item
      )
    );
  };

  const resolveProviderById = (providerId: string) =>
    providerCatalog.find((provider) => provider.id === providerId);

  const resolveServiceById = (providerId: string, serviceId: string) => {
    const provider = resolveProviderById(providerId);
    return provider?.services.find((service) => service.id === serviceId);
  };

  const applyServiceDefaults = (
    addOnKey: string,
    pricing: AddOnPricingDraft,
    service: FulfillmentService | undefined,
    options?: { force?: boolean },
  ) => {
    if (!service) {
      return;
    }
    const patch = buildServicePresetPatch(service, pricing, draft.currency || "USD", options);
    if (Object.keys(patch).length > 0) {
      updateAddOnPricing(addOnKey, patch);
    }
  };

  const addServiceRule = (itemKey: string) => {
    setAddOns((previous) =>
      previous.map((item) =>
        item.key === itemKey
          ? { ...item, pricing: { ...item.pricing, rules: [...item.pricing.rules, createServiceRuleDraft()] } }
          : item
      )
    );
  };

  const updateServiceRule = <Key extends keyof ServiceRuleDraft>(
    itemKey: string,
    ruleKey: string,
    key: Key,
    value: ServiceRuleDraft[Key],
  ) => {
    setAddOns((previous) =>
      previous.map((item) => {
        if (item.key !== itemKey) {
          return item;
        }
        return {
          ...item,
          pricing: {
            ...item.pricing,
            rules: item.pricing.rules.map((rule) => (rule.key === ruleKey ? { ...rule, [key]: value } : rule)),
          },
        };
      }),
    );
  };

  const removeServiceRule = (itemKey: string, ruleKey: string) => {
    setAddOns((previous) =>
      previous.map((item) => {
        if (item.key !== itemKey) {
          return item;
        }
        return {
          ...item,
          pricing: {
            ...item.pricing,
            rules: item.pricing.rules.filter((rule) => rule.key !== ruleKey),
          },
        };
      }),
    );
  };

  const handleRemoveAddOn = (itemKey: string) => {
    setAddOns((previous) => previous.filter((item) => item.key !== itemKey));
  };

  const handleAddCustomField = () => {
    setCustomFields((previous) => [...previous, createCustomFieldDraft()]);
  };

  const updateCustomField = <Key extends keyof CustomFieldDraft>(
    fieldKey: string,
    key: Key,
    value: CustomFieldDraft[Key]
  ) => {
    setCustomFields((previous) => previous.map((field) => (field.key === fieldKey ? { ...field, [key]: value } : field)));
  };

  const updateCustomFieldValidation = (
    fieldKey: string,
    partial: Partial<CustomFieldDraft["validation"]>
  ) => {
    setCustomFields((previous) =>
      previous.map((field) =>
        field.key === fieldKey
          ? {
              ...field,
              validation: { ...field.validation, ...partial }
            }
          : field
      )
    );
  };

  const updateRegexTester = (fieldKey: string, patch: Partial<CustomFieldDraft["regexTester"]>) => {
    setCustomFields((previous) =>
      previous.map((field) =>
        field.key === fieldKey
          ? {
              ...field,
              regexTester: { ...field.regexTester, ...patch }
            }
          : field
      )
    );
  };

  const setFieldVisibilityMode = (fieldKey: string, mode: CustomFieldVisibilityDraft["mode"]) => {
    setCustomFields((previous) =>
      previous.map((field) =>
        field.key === fieldKey
          ? {
              ...field,
              visibility: {
                ...field.visibility,
                mode
              }
            }
          : field
      )
    );
  };

  const createVisibilityCondition = (
    kind: FieldVisibilityConditionDraft["kind"]
  ): FieldVisibilityConditionDraft => {
    if (kind === "option") {
      const firstGroup = optionGroups.find((group) => group.options.length > 0);
      return {
        key: generateKey("field-visibility"),
        kind: "option",
        groupKey: firstGroup?.key ?? "",
        optionKey: firstGroup?.options[0]?.key ?? ""
      };
    }
    if (kind === "addOn") {
      return {
        key: generateKey("field-visibility"),
        kind: "addOn",
        addOnKey: addOns[0]?.key ?? ""
      };
    }
    if (kind === "subscriptionPlan") {
      return {
        key: generateKey("field-visibility"),
        kind: "subscriptionPlan",
        planKey: subscriptionPlans[0]?.key ?? ""
      };
    }
    return {
      key: generateKey("field-visibility"),
      kind: "channel",
      channel: draft.channelEligibility[0] ?? CHANNEL_OPTIONS[0]?.value ?? "storefront"
    };
  };

  const addFieldVisibilityCondition = (
    fieldKey: string,
    kind: FieldVisibilityConditionDraft["kind"]
  ) => {
    const condition = createVisibilityCondition(kind);
    setCustomFields((previous) =>
      previous.map((field) =>
        field.key === fieldKey
          ? {
              ...field,
              visibility: {
                ...field.visibility,
                conditions: [...field.visibility.conditions, condition]
              }
            }
          : field
      )
    );
  };

  const updateFieldVisibilityCondition = (
    fieldKey: string,
    conditionKey: string,
    partial: FieldVisibilityConditionUpdate
  ) => {
    setCustomFields((previous) =>
      previous.map((field) => {
        if (field.key !== fieldKey) {
          return field;
        }
        return {
          ...field,
          visibility: {
            ...field.visibility,
            conditions: field.visibility.conditions.map((condition) =>
              condition.key === conditionKey ? { ...condition, ...partial } : condition
            )
          }
        };
      })
    );
  };

  const setFieldVisibilityConditionKind = (
    fieldKey: string,
    conditionKey: string,
    kind: FieldVisibilityConditionDraft["kind"]
  ) => {
    setCustomFields((previous) =>
      previous.map((field) => {
        if (field.key !== fieldKey) {
          return field;
        }
        return {
          ...field,
          visibility: {
            ...field.visibility,
            conditions: field.visibility.conditions.map((condition) =>
              condition.key === conditionKey ? createVisibilityCondition(kind) : condition
            )
          }
        };
      })
    );
  };

  const removeFieldVisibilityCondition = (fieldKey: string, conditionKey: string) => {
    setCustomFields((previous) =>
      previous.map((field) => {
        if (field.key !== fieldKey) {
          return field;
        }
        return {
          ...field,
          visibility: {
            ...field.visibility,
            conditions: field.visibility.conditions.filter(
              (condition) => condition.key !== conditionKey
            )
          }
        };
      })
    );
  };

  const serializeVisibilityDraft = useCallback((
    visibility: CustomFieldVisibilityDraft
  ): ProductCustomFieldMetadata["conditionalVisibility"] | null => {
    if (visibility.conditions.length === 0) {
      return null;
    }
    const mapped = visibility.conditions
      .map<CustomFieldVisibilityCondition | null>((condition) => {
        if (condition.kind === "option") {
          if (!condition.optionKey) {
            return null;
          }
          const descriptor: CustomFieldVisibilityCondition = {
            kind: "option",
            optionKey: condition.optionKey
          };
          if (condition.groupKey) {
            descriptor.groupKey = condition.groupKey;
          }
          return descriptor;
        }
        if (condition.kind === "addOn") {
          if (!condition.addOnKey) {
            return null;
          }
          return {
            kind: "addOn",
            addOnKey: condition.addOnKey
          };
        }
        if (condition.kind === "subscriptionPlan") {
          if (!condition.planKey) {
            return null;
          }
          return {
            kind: "subscriptionPlan",
            planKey: condition.planKey
          };
        }
        if (condition.kind === "channel") {
          if (!condition.channel) {
            return null;
          }
          return {
            kind: "channel",
            channel: condition.channel
          };
        }
        return null;
      })
      .filter((entry): entry is CustomFieldVisibilityCondition => entry != null);
    return mapped.length > 0
      ? {
          mode: visibility.mode,
          conditions: mapped
        }
      : null;
  }, []);

  const handleRemoveCustomField = (fieldKey: string) => {
    setCustomFields((previous) => previous.filter((field) => field.key !== fieldKey));
  };

  const handleAddSubscriptionPlan = () => {
    setSubscriptionPlans((previous) => [...previous, createInitialPlan()]);
  };

  const updateSubscriptionPlan = <Key extends keyof SubscriptionPlanDraft>(
    planKey: string,
    key: Key,
    value: SubscriptionPlanDraft[Key]
  ) => {
    setSubscriptionPlans((previous) =>
      previous.map((plan) => {
        if (plan.key !== planKey) {
          if (key === "isDefault" && value === true) {
            return { ...plan, isDefault: false };
          }
          return plan;
        }
        if (key === "isDefault" && value === true) {
          return { ...plan, isDefault: true };
        }
        return { ...plan, [key]: value };
      })
    );
  };

  const handleToggleDefaultPlan = (planKey: string) => {
    setSubscriptionPlans((previous) =>
      previous.map((plan) => (plan.key === planKey ? { ...plan, isDefault: true } : { ...plan, isDefault: false }))
    );
  };

  const handleRemoveSubscriptionPlan = (planKey: string) => {
    setSubscriptionPlans((previous) => previous.filter((plan) => plan.key !== planKey));
  };

  const revokePreviewUrl = (asset: AssetDraft | undefined) => {
    if (asset?.previewUrl) {
      URL.revokeObjectURL(asset.previewUrl);
    }
  };

  const clearAssetDrafts = () => {
    assetDrafts.forEach(revokePreviewUrl);
    setAssetDrafts([]);
  };

  const parseNumericString = (value: string): number | null => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseDelimitedList = (value: string): string[] =>
    value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const parseJsonInput = (value: string): Record<string, unknown> | null => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const parseCommaSeparatedList = useCallback(
    (value: string): string[] =>
      value
        .split(/[,\\n]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    []
  );

  const mapRuleDraftsToMetadata = useCallback((addOnKey: string, drafts: ServiceRuleDraft[]): ServiceOverrideRule[] => {
    const rules: ServiceOverrideRule[] = [];
    drafts.forEach((rule, index) => {
      const channels = parseCommaSeparatedList(rule.channels);
      const regions = parseCommaSeparatedList(rule.regions);
      const minAmount = parseNumericString(rule.minAmount);
      const maxAmount = parseNumericString(rule.maxAmount);
      const minDrip = parseNumericString(rule.minDrip);
      const maxDrip = parseNumericString(rule.maxDrip);

      const conditions: ServiceOverrideCondition[] = [];
      if (channels.length > 0) {
        conditions.push({ kind: "channel", channels });
      }
      if (regions.length > 0) {
        conditions.push({ kind: "geo", regions });
      }
      if (minAmount != null || maxAmount != null) {
        conditions.push({ kind: "amount", min: minAmount ?? undefined, max: maxAmount ?? undefined });
      }
      if (minDrip != null || maxDrip != null) {
        conditions.push({ kind: "drip", min: minDrip ?? undefined, max: maxDrip ?? undefined });
      }
      if (conditions.length === 0) {
        return;
      }

      const overrides: ServiceOverrideRule["overrides"] = {};
      const overrideService = rule.overrideServiceId.trim();
      if (overrideService) {
        overrides.serviceId = overrideService;
      }
      const overrideProvider = rule.overrideProviderId.trim();
      if (overrideProvider) {
        overrides.providerId = overrideProvider;
      }
      const ruleCostAmount = parseNumericString(rule.costAmount);
      if (ruleCostAmount != null) {
        overrides.costAmount = ruleCostAmount;
      }
      const ruleCostCurrency = rule.costCurrency.trim().toUpperCase();
      if (ruleCostCurrency) {
        overrides.costCurrency = ruleCostCurrency;
      }
      const ruleMargin = parseNumericString(rule.marginTarget);
      if (ruleMargin != null) {
        overrides.marginTarget = ruleMargin;
      }
      if (rule.fulfillmentMode) {
        overrides.fulfillmentMode = rule.fulfillmentMode;
      }
      const ruleDripOverride = parseNumericString(rule.dripPerDay);
      if (ruleDripOverride != null) {
        overrides.dripPerDay = ruleDripOverride;
      }
      const rulePreviewQuantity = parseNumericString(rule.previewQuantity);
      if (rulePreviewQuantity != null) {
        overrides.previewQuantity = rulePreviewQuantity;
      }
      const payloadTemplate = parseJsonInput(rule.payloadTemplate);
      if (payloadTemplate) {
        overrides.payloadTemplate = payloadTemplate;
      }

      rules.push({
        id: rule.key || `${addOnKey}-rule-${index + 1}`,
        label: rule.label.trim() || undefined,
        description: rule.description.trim() || undefined,
        priority: parseNumericString(rule.priority) ?? undefined,
        conditions,
        overrides,
      });
    });
    return rules;
  }, [parseCommaSeparatedList]);

  const buildOptionMetadata = (option: OptionDraft): ProductOptionMetadata => {
    const metadata: ProductOptionMetadata = {
      editorKey: option.key
    };
    if (option.recommended) {
      metadata.recommended = true;
    }

    const pricing = option.pricing;
    const amount = parseNumericString(pricing.amount);
    const basePrice = parseNumericString(pricing.basePrice);
    const unitPrice = parseNumericString(pricing.unitPrice);
    const dripMinPerDay = parseNumericString(pricing.dripMinPerDay);
    const amountUnit = pricing.amountUnit.trim();

    if (amount != null && amount > 0 && basePrice != null && unitPrice != null && amountUnit.length > 0) {
      const structuredPricing: ProductOptionMetadata["structuredPricing"] = {
        amount,
        amountUnit,
        basePrice,
        unitPrice,
        dripMinPerDay: dripMinPerDay ?? null,
        discountTiers: pricing.discountTiers
          .map((tier) => {
            const minAmount = parseNumericString(tier.minAmount);
            const tierUnitPrice = parseNumericString(tier.unitPrice);
            const label = tier.label.trim();
            if (minAmount == null || minAmount <= 0 || tierUnitPrice == null) {
              return null;
            }
            return {
              minAmount,
              unitPrice: tierUnitPrice,
              label: label.length > 0 ? label : null
            };
          })
          .filter((tier): tier is NonNullable<typeof tier> => tier != null),
      };

      if (!structuredPricing.discountTiers || structuredPricing.discountTiers.length === 0) {
        structuredPricing.discountTiers = null;
      }

      metadata.structuredPricing = structuredPricing;
    }

    const media = option.media
      .map((attachment) => {
        const assetId = attachment.assetId.trim();
        if (!assetId) {
          return null;
        }
        const usage = attachment.usage.trim();
        const label = attachment.label.trim();
        return {
          assetId,
          usage: usage.length > 0 ? usage : null,
          label: label.length > 0 ? label : null
        };
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> => attachment != null);

    if (media.length > 0) {
      metadata.media = media;
    }

    const marketingTagline = option.marketingTagline.trim();
    if (marketingTagline.length > 0) {
      metadata.marketingTagline = marketingTagline;
    }

    const fulfillmentSla = option.fulfillmentSla.trim();
    if (fulfillmentSla.length > 0) {
      metadata.fulfillmentSla = fulfillmentSla;
    }

    const heroImage = option.heroImageUrl.trim();
    if (heroImage.length > 0) {
      metadata.heroImageUrl = heroImage;
    }

    const calculatorExpression = option.calculatorExpression.trim();
    if (calculatorExpression.length > 0) {
      const calculator: ProductOptionCalculatorMetadata = { expression: calculatorExpression };
      const sampleAmount = parseNumericString(option.calculatorSampleAmount);
      if (sampleAmount != null) {
        calculator.sampleAmount = sampleAmount;
      }
      const sampleDays = parseNumericString(option.calculatorSampleDays);
      if (sampleDays != null) {
        calculator.sampleDays = sampleDays;
      }
      metadata.calculator = calculator;
    }

    return metadata;
  };

  const resolveAddOnMetadata = useCallback((
    addOn: AddOnDraft
  ): { metadata: ProductAddOnMetadata | null; fallbackPriceDelta: number } => {
    const fallback = Number.isFinite(Number(addOn.priceDelta)) ? Number(addOn.priceDelta) : 0;
    const mode = addOn.pricing.mode;
    const amount = parseNumericString(addOn.pricing.amount);
    const serviceId = addOn.pricing.serviceId.trim();

    if (mode === "flat") {
      if (amount != null) {
        return {
          metadata: { pricing: { mode, amount } },
          fallbackPriceDelta: amount
        };
      }
      return { metadata: null, fallbackPriceDelta: fallback };
    }

    if (mode === "percentage") {
      if (amount != null) {
        return {
          metadata: { pricing: { mode, amount } },
          fallbackPriceDelta: fallback
        };
      }
      return { metadata: null, fallbackPriceDelta: fallback };
    }

    if (mode === "serviceOverride") {
      if (serviceId.length === 0) {
        return { metadata: null, fallbackPriceDelta: fallback };
      }
      const pricing: NonNullable<ProductAddOnMetadata["pricing"]> = {
        mode,
        serviceId
      };
      if (amount != null) {
        pricing.amount = amount;
      }
      const previewQuantity = parseNumericString(addOn.pricing.previewQuantity);
      if (previewQuantity != null) {
        pricing.previewQuantity = previewQuantity;
      }
      const providerId = addOn.pricing.providerId.trim();
      if (providerId.length > 0) {
        pricing.providerId = providerId;
      }
      const costAmount = parseNumericString(addOn.pricing.costAmount);
      if (costAmount != null) {
        pricing.costAmount = costAmount;
      }
      const costCurrency = addOn.pricing.costCurrency.trim();
      if (costCurrency.length > 0) {
        pricing.costCurrency = costCurrency.toUpperCase();
      }
      const marginTarget = parseNumericString(addOn.pricing.marginTarget);
      if (marginTarget != null) {
        pricing.marginTarget = marginTarget;
      }
      const fulfillmentMode = addOn.pricing.fulfillmentMode;
      if (fulfillmentMode) {
        pricing.fulfillmentMode = fulfillmentMode;
      }
      const dripPerDay = parseNumericString(addOn.pricing.dripPerDay);
      if (dripPerDay != null) {
        pricing.dripPerDay = dripPerDay;
      }
      const payloadTemplate = parseJsonInput(addOn.pricing.payloadTemplate);
      if (payloadTemplate) {
        pricing.payloadTemplate = payloadTemplate;
      }
      const ruleMetadata = mapRuleDraftsToMetadata(addOn.key, addOn.pricing.rules);
      if (ruleMetadata.length > 0) {
        pricing.rules = ruleMetadata;
      }
      return {
        metadata: { pricing },
        fallbackPriceDelta: amount != null ? amount : fallback
      };
    }

    return { metadata: null, fallbackPriceDelta: fallback };
  }, [mapRuleDraftsToMetadata]);

  const collectValidationErrors = (params: {
    slug: string;
    title: string;
    category: string;
    basePrice: number;
  }): string[] => {
    const errors: string[] = [];
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    if (!params.slug) {
      errors.push("Slug is required.");
    } else if (!slugPattern.test(params.slug)) {
      errors.push("Slug must contain lowercase letters, numbers, and hyphens only.");
    }

    if (!params.title) {
      errors.push("Title is required.");
    }

    if (!params.category) {
      errors.push("Category is required.");
    }

    if (!Number.isFinite(params.basePrice) || params.basePrice < 0) {
      errors.push("Base price must be a non-negative number.");
    }

    optionGroups.forEach((group, groupIndex) => {
      const groupName = group.name.trim();
      const optionLabels = group.options.filter((option) => option.label.trim().length > 0);
      if (groupName && optionLabels.length === 0) {
        errors.push(`Option group ${groupIndex + 1} requires at least one option.`);
      }
      group.options.forEach((option, optionIndex) => {
        if (option.label.trim().length > 0 && option.priceDelta.trim().length > 0) {
          const parsed = Number(option.priceDelta);
          if (!Number.isFinite(parsed)) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid price delta.`);
          }
        }
        const { pricing } = option;
        if (pricing.amount.trim().length > 0) {
          const parsedAmount = Number(pricing.amount);
          if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid amount.`);
          }
          if (pricing.amountUnit.trim().length === 0) {
            errors.push(
              `Option ${optionIndex + 1} in group ${groupIndex + 1} requires an amount unit when amount is provided.`
            );
          }
        }
        if (pricing.basePrice.trim().length > 0) {
          const parsedBase = Number(pricing.basePrice);
          if (!Number.isFinite(parsedBase) || parsedBase < 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid base price.`);
          }
        }
        if (pricing.unitPrice.trim().length > 0) {
          const parsedUnit = Number(pricing.unitPrice);
          if (!Number.isFinite(parsedUnit) || parsedUnit < 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid unit price.`);
          }
        }
        if (pricing.dripMinPerDay.trim().length > 0) {
          const parsedDrip = Number(pricing.dripMinPerDay);
          if (!Number.isFinite(parsedDrip) || parsedDrip < 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid drip minimum per day.`);
          }
        }
        pricing.discountTiers.forEach((tier, tierIndex) => {
          const hasMinAmount = tier.minAmount.trim().length > 0;
          const hasUnitPrice = tier.unitPrice.trim().length > 0;
          if (!hasMinAmount && !hasUnitPrice && tier.label.trim().length === 0) {
            return;
          }
          const parsedMin = Number(tier.minAmount);
          if (!Number.isFinite(parsedMin) || parsedMin <= 0) {
            errors.push(
              `Option ${optionIndex + 1} in group ${groupIndex + 1} discount tier ${tierIndex + 1} has an invalid minimum amount.`
            );
          }
          const parsedTierPrice = Number(tier.unitPrice);
          if (!Number.isFinite(parsedTierPrice) || parsedTierPrice < 0) {
            errors.push(
              `Option ${optionIndex + 1} in group ${groupIndex + 1} discount tier ${tierIndex + 1} has an invalid unit price.`
            );
          }
        });
        if (!isCalculatorExpressionValid(option.calculatorExpression)) {
          errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid calculator expression.`);
        }
        if (option.calculatorSampleAmount.trim().length > 0) {
          const parsed = Number(option.calculatorSampleAmount);
          if (!Number.isFinite(parsed) || parsed < 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid sample amount.`);
          }
        }
        if (option.calculatorSampleDays.trim().length > 0) {
          const parsed = Number(option.calculatorSampleDays);
          if (!Number.isFinite(parsed) || parsed < 0) {
            errors.push(`Option ${optionIndex + 1} in group ${groupIndex + 1} has an invalid sample days value.`);
          }
        }
      });
    });

    addOns.forEach((item, index) => {
      if (item.label.trim().length > 0 && item.priceDelta.trim().length > 0) {
        const parsed = Number(item.priceDelta);
        if (!Number.isFinite(parsed)) {
          errors.push(`Add-on ${index + 1} has an invalid price delta.`);
        }
      }

      if (item.pricing.mode === "flat") {
        const parsed = parseNumericString(item.pricing.amount);
        if (parsed == null || parsed < 0) {
          errors.push(`Add-on ${index + 1} requires a non-negative flat amount.`);
        }
      } else if (item.pricing.mode === "percentage") {
        const parsed = parseNumericString(item.pricing.amount);
        if (parsed == null || parsed < 0) {
          errors.push(`Add-on ${index + 1} requires a non-negative percentage multiplier.`);
        }
      } else if (item.pricing.mode === "serviceOverride") {
        if (item.pricing.serviceId.trim().length === 0) {
          errors.push(`Add-on ${index + 1} requires a service override identifier.`);
        }
        if (item.pricing.amount.trim().length > 0) {
          const parsed = parseNumericString(item.pricing.amount);
          if (parsed == null || parsed < 0) {
            errors.push(`Add-on ${index + 1} override amount must be a non-negative number.`);
          }
        }
      }
    });

    customFields.forEach((field, index) => {
      const validation = field.validation;
      const minTrimmed = validation?.minLength.trim() ?? "";
      const maxTrimmed = validation?.maxLength.trim() ?? "";
      const patternTrimmed = validation?.pattern.trim() ?? "";

      const minLengthValue =
        minTrimmed.length > 0 && Number.isFinite(Number(minTrimmed)) ? Number(minTrimmed) : null;
      const maxLengthValue =
        maxTrimmed.length > 0 && Number.isFinite(Number(maxTrimmed)) ? Number(maxTrimmed) : null;

      if (minTrimmed.length > 0) {
        const parsed = Number(minTrimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          errors.push(`Field ${index + 1} has an invalid minimum length.`);
        }
      }
      if (maxTrimmed.length > 0) {
        const parsed = Number(maxTrimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          errors.push(`Field ${index + 1} has an invalid maximum length.`);
        }
      }
      if (minLengthValue != null && maxLengthValue != null && maxLengthValue < minLengthValue) {
        errors.push(`Field ${index + 1} maximum length must be greater than or equal to minimum length.`);
      }
      if (patternTrimmed.length > 0) {
        try {
          // eslint-disable-next-line no-new
          new RegExp(patternTrimmed);
        } catch {
          errors.push(`Field ${index + 1} has an invalid regex pattern.`);
        }
      }

      if (field.fieldType === "number") {
        const minValueTrimmed = validation?.minValue.trim() ?? "";
        const maxValueTrimmed = validation?.maxValue.trim() ?? "";
        let minValue: number | null = null;
        if (minValueTrimmed.length > 0) {
          const parsed = Number(minValueTrimmed);
          if (!Number.isFinite(parsed)) {
            errors.push(`Field ${index + 1} has an invalid minimum value.`);
          } else {
            minValue = parsed;
          }
        }
        let maxValue: number | null = null;
        if (maxValueTrimmed.length > 0) {
          const parsed = Number(maxValueTrimmed);
          if (!Number.isFinite(parsed)) {
            errors.push(`Field ${index + 1} has an invalid maximum value.`);
          } else {
            maxValue = parsed;
          }
        }
        if (minValue != null && maxValue != null && maxValue < minValue) {
          errors.push(`Field ${index + 1} maximum value must be greater than or equal to minimum value.`);
        }
        const defaultTrimmed = field.defaultValue.trim();
        if (defaultTrimmed.length > 0) {
          const parsedDefault = Number(defaultTrimmed);
          if (!Number.isFinite(parsedDefault)) {
            errors.push(`Field ${index + 1} default value must be a valid number.`);
          } else {
            if (minValue != null && parsedDefault < minValue) {
              errors.push(`Field ${index + 1} default value must be greater than or equal to the minimum value.`);
            }
            if (maxValue != null && parsedDefault > maxValue) {
              errors.push(`Field ${index + 1} default value must be less than or equal to the maximum value.`);
            }
          }
        }
      } else {
        const defaultTrimmed = field.defaultValue.trim();
        if (defaultTrimmed.length > 0) {
          if (minLengthValue != null && defaultTrimmed.length < minLengthValue) {
            errors.push(`Field ${index + 1} default value must respect the minimum length.`);
          }
          if (maxLengthValue != null && defaultTrimmed.length > maxLengthValue) {
            errors.push(`Field ${index + 1} default value must respect the maximum length.`);
          }
          if (patternTrimmed.length > 0) {
            try {
              const regex = new RegExp(patternTrimmed);
              if (!regex.test(defaultTrimmed)) {
                errors.push(`Field ${index + 1} default value must match the configured pattern.`);
              }
            } catch {
              // invalid regex already reported above
            }
          }
        }
      }

      field.visibility.conditions.forEach((condition, conditionIndex) => {
        const label = `Field ${index + 1} visibility rule ${conditionIndex + 1}`;
        if (condition.kind === "option") {
          if (!condition.groupKey) {
            errors.push(`${label} must reference an option group.`);
          }
          if (!condition.optionKey) {
            errors.push(`${label} must target an option.`);
          }
          const group = optionGroups.find((groupCandidate) => groupCandidate.key === condition.groupKey);
          if (!group) {
            errors.push(`${label} references an unknown option group.`);
          } else {
            if (!group.options.some((option) => option.key === condition.optionKey)) {
              errors.push(`${label} references an unknown option.`);
            }
          }
        } else if (condition.kind === "addOn") {
          if (!condition.addOnKey) {
            errors.push(`${label} must target an add-on.`);
          } else if (!addOns.some((item) => item.key === condition.addOnKey)) {
            errors.push(`${label} references an unknown add-on.`);
          }
        } else if (condition.kind === "subscriptionPlan") {
          if (!condition.planKey) {
            errors.push(`${label} must target a subscription plan.`);
          } else if (!subscriptionPlans.some((plan) => plan.key === condition.planKey)) {
            errors.push(`${label} references an unknown subscription plan.`);
          }
        } else if (condition.kind === "channel") {
          if (!condition.channel) {
            errors.push(`${label} must target a valid channel.`);
          } else if (!CHANNEL_OPTIONS.some((option) => option.value === condition.channel)) {
            errors.push(`${label} references an unknown channel.`);
          }
        }
      });
    });

    const activePlans = subscriptionPlans.filter((plan) => plan.label.trim().length > 0);

    activePlans.forEach((plan, index) => {
      if (plan.priceMultiplier.trim().length > 0) {
        const parsed = Number(plan.priceMultiplier);
        if (!Number.isFinite(parsed) || parsed < 0) {
          errors.push(`Subscription plan ${index + 1} has an invalid multiplier.`);
        }
      }
      if (plan.priceDelta.trim().length > 0) {
        const parsed = Number(plan.priceDelta);
        if (!Number.isFinite(parsed)) {
          errors.push(`Subscription plan ${index + 1} has an invalid delta.`);
        }
      }
    });

    if (activePlans.length > 0 && !activePlans.some((plan) => plan.isDefault)) {
      errors.push("Select a default subscription plan.");
    }

    journeyComponents.forEach((component, index) => {
      const label = `Journey component ${index + 1}`;
      if (!component.componentId) {
        errors.push(`${label} must target a component definition.`);
      }
      component.bindings.forEach((binding, bindingIndex) => {
        const bindingLabel = `${label} binding ${bindingIndex + 1}`;
        if (binding.inputKey.trim().length === 0) {
          errors.push(`${bindingLabel} requires an input key.`);
          return;
        }
        if (binding.kind === "static") {
          if (binding.value.trim().length === 0) {
            errors.push(`${bindingLabel} requires a value.`);
          }
        } else if (binding.kind === "product_field") {
          if (binding.path.trim().length === 0) {
            errors.push(`${bindingLabel} requires a product field path.`);
          }
        } else if (binding.kind === "runtime") {
          if (binding.source.trim().length === 0) {
            errors.push(`${bindingLabel} requires a runtime source identifier.`);
          }
        }
      });
      const metadataPayload = component.metadataJson.trim();
      if (metadataPayload.length > 0) {
        try {
          const parsed = JSON.parse(metadataPayload);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            errors.push(`${label} metadata must be a JSON object.`);
          }
        } catch {
          errors.push(`${label} metadata must be valid JSON.`);
        }
      }
    });

    return errors;
  };

  const buildConfigurationPayload = () => {
    const normalizedGroups = optionGroups
      .map((group, groupIndex) => {
        const cleanedOptions = group.options
          .filter((option) => option.label.trim().length > 0)
          .map((option, optionIndex) => ({
            id: null,
            name: option.label.trim(),
            description: option.description.trim() || null,
            priceDelta: Number.isFinite(Number(option.priceDelta)) ? Number(option.priceDelta) : 0,
            displayOrder: optionIndex,
            metadata: buildOptionMetadata(option)
          }));

        if (!group.name.trim() || cleanedOptions.length === 0) {
          return null;
        }

        return {
          id: null,
          name: group.name.trim(),
          description: group.description.trim() || null,
          groupType: group.type,
          isRequired: group.required,
          displayOrder: groupIndex,
          metadata: { editorKey: group.key },
          options: cleanedOptions
        };
      })
      .filter((group): group is NonNullable<typeof group> => group != null);

    const normalizedAddOns = addOns
      .filter((item) => item.label.trim().length > 0)
      .map((item, index) => {
        const { metadata, fallbackPriceDelta } = resolveAddOnMetadata(item);
        const decoratedMetadata =
          metadata != null
            ? { ...metadata, editorKey: item.key }
            : { editorKey: item.key };
        return {
          id: null,
          label: item.label.trim(),
          description: item.description.trim() || null,
          priceDelta: fallbackPriceDelta,
          metadata: decoratedMetadata,
          isRecommended: item.recommended,
          displayOrder: index
        };
      });

    const normalizedFields = customFields
      .filter((field) => field.label.trim().length > 0)
      .map((field, index) => {
        const metadata: ProductCustomFieldMetadata = { editorKey: field.key };
        const validationMeta: Record<string, unknown> = {};
        const minTrimmed = field.validation.minLength.trim();
        if (minTrimmed.length > 0) {
          const parsed = Number(minTrimmed);
          if (Number.isFinite(parsed) && parsed >= 0) {
            validationMeta.minLength = parsed;
          }
        }
        const maxTrimmed = field.validation.maxLength.trim();
        if (maxTrimmed.length > 0) {
          const parsed = Number(maxTrimmed);
          if (Number.isFinite(parsed) && parsed >= 0) {
            validationMeta.maxLength = parsed;
          }
        }
        const patternTrimmed = field.validation.pattern.trim();
        if (patternTrimmed.length > 0) {
          validationMeta.pattern = patternTrimmed;
        }
        const regexFlagsTrimmed = field.validation.regexFlags.trim();
        const regexDescriptionTrimmed = field.validation.regexDescription.trim();
        if (patternTrimmed.length > 0 && (regexFlagsTrimmed.length > 0 || regexDescriptionTrimmed.length > 0)) {
          const regexPayload: Record<string, unknown> = {
            pattern: patternTrimmed
          };
          if (regexFlagsTrimmed.length > 0) {
            regexPayload.flags = regexFlagsTrimmed;
          }
          if (regexDescriptionTrimmed.length > 0) {
            regexPayload.description = regexDescriptionTrimmed;
          }
          const testerSample = field.regexTester.sampleValue.trim();
          if (testerSample.length > 0) {
            regexPayload.sampleValue = testerSample;
          }
          validationMeta.regex = regexPayload;
        }
        if (field.validation.disallowWhitespace) {
          validationMeta.disallowWhitespace = true;
        }
        if (field.fieldType === "number") {
          const minValueTrimmed = field.validation.minValue.trim();
          if (minValueTrimmed.length > 0) {
            const parsed = Number(minValueTrimmed);
            if (Number.isFinite(parsed)) {
              validationMeta.minValue = parsed;
            }
          }
          const maxValueTrimmed = field.validation.maxValue.trim();
          if (maxValueTrimmed.length > 0) {
            const parsed = Number(maxValueTrimmed);
            if (Number.isFinite(parsed)) {
              validationMeta.maxValue = parsed;
            }
          }
          const numericStep = parseNumericString(field.validation.numericStep);
          if (numericStep != null && numericStep > 0) {
            validationMeta.numericStep = numericStep;
          }
        }
        const allowedValues = parseDelimitedList(field.validation.allowedValues);
        if (allowedValues.length > 0) {
          validationMeta.allowedValues = allowedValues;
        }
        if (Object.keys(validationMeta).length > 0) {
          metadata.validation = validationMeta as ProductCustomFieldMetadata["validation"];
        }
        const defaultTrimmed = field.defaultValue.trim();
        if (defaultTrimmed.length > 0) {
          metadata.defaultValue = defaultTrimmed;
        }
        const samples = parseDelimitedList(field.sampleValues);
        if (samples.length > 0) {
          metadata.sampleValues = samples;
        }
        const serializedVisibility = serializeVisibilityDraft(field.visibility);
        if (serializedVisibility) {
          metadata.conditionalVisibility = serializedVisibility;
        }
        metadata.passthrough = {
          checkout: field.exposeInCheckout,
          fulfillment: field.exposeInFulfillment
        };
        const testerSample = field.regexTester.sampleValue.trim();
        if (testerSample.length > 0 || typeof field.regexTester.lastResult === "boolean") {
          metadata.regexTester = {
            sampleValue: testerSample.length > 0 ? testerSample : null,
            lastResult:
              typeof field.regexTester.lastResult === "boolean" ? field.regexTester.lastResult : null
          };
        }

        return {
          id: null,
          label: field.label.trim(),
          fieldType: field.fieldType,
          placeholder: field.placeholder.trim() || null,
          helpText: field.helpText.trim() || null,
          isRequired: field.required,
          displayOrder: index,
          metadata
        };
      });

    const normalizedPlans = subscriptionPlans
      .filter((plan) => plan.label.trim().length > 0)
      .map((plan, index) => ({
        id: null,
        label: plan.label.trim(),
        description: plan.description.trim() || null,
        billingCycle: toConfiguratorBillingCycle(plan.billingCycle),
        priceMultiplier:
          plan.priceMultiplier.trim().length > 0 && Number.isFinite(Number(plan.priceMultiplier))
            ? Number(plan.priceMultiplier)
            : null,
        priceDelta:
          plan.priceDelta.trim().length > 0 && Number.isFinite(Number(plan.priceDelta))
            ? Number(plan.priceDelta)
            : null,
        isDefault: plan.isDefault,
        displayOrder: index
      }));

    const normalizedJourneyAssignments = journeyComponents
      .map((entry, index) => {
        if (!entry.componentId) {
          return null;
        }
        const parsedOrder = Number(entry.displayOrder);
        const displayOrder = Number.isFinite(parsedOrder) ? parsedOrder : index;
        const normalizedChannels = parseChannelEligibilityValue(entry.channelEligibility);
        const bindings = entry.bindings
          .map<JourneyComponentInputBinding | null>((binding) => {
            const inputKey = binding.inputKey.trim();
            if (!inputKey) {
              return null;
            }
            if (binding.kind === "static") {
              return {
                kind: "static",
                inputKey,
                value: binding.value,
              };
            }
            if (binding.kind === "product_field") {
              const path = binding.path.trim();
              if (!path) {
                return null;
              }
              return {
                kind: "product_field",
                inputKey,
                path,
                required: binding.required ?? false,
              };
            }
            const source = binding.source.trim();
            if (!source) {
              return null;
            }
            return {
              kind: "runtime",
              inputKey,
              source,
              required: binding.required ?? false,
            };
          })
          .filter((binding): binding is JourneyComponentInputBinding => binding !== null);
        let metadata: Record<string, unknown> | undefined;
        const trimmedMetadata = entry.metadataJson.trim();
        if (trimmedMetadata.length > 0) {
          try {
            const parsed = JSON.parse(trimmedMetadata);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              metadata = parsed as Record<string, unknown>;
            }
          } catch {
            // ignore invalid JSON, UI surfaces parse issues
          }
        }
        return {
          id: entry.id ?? null,
          componentId: entry.componentId,
          displayOrder,
          channelEligibility: normalizedChannels.length ? normalizedChannels : undefined,
          isRequired: entry.isRequired,
          bindings,
          metadata,
        };
      })
      .filter(
        (assignment): assignment is {
          id: string | null;
          componentId: string;
          displayOrder: number;
          channelEligibility?: string[];
          isRequired: boolean;
          bindings: JourneyComponentInputBinding[];
          metadata?: Record<string, unknown>;
        } => assignment !== null
      );

    const hasConfiguration =
      normalizedGroups.length > 0 ||
      normalizedAddOns.length > 0 ||
      normalizedFields.length > 0 ||
      normalizedPlans.length > 0 ||
      normalizedJourneyAssignments.length > 0;

    if (!hasConfiguration) {
      return null;
    }

    return {
      optionGroups: normalizedGroups,
      addOns: normalizedAddOns,
      customFields: normalizedFields,
      subscriptionPlans: normalizedPlans,
      journeyComponents: normalizedJourneyAssignments,
    };
  };

  const uploadQueuedAssets = async (productId: string) => {
    if (assetDrafts.length === 0) {
      return;
    }
    setIsUploadingAssets(true);
    try {
      const manifest = assetDrafts.map((asset, index) => ({
        clientId: asset.clientId,
        label: asset.label.trim() || asset.file.name,
        altText: asset.altText.trim() || null,
        usageTags: asset.usageTags && asset.usageTags.length > 0 ? asset.usageTags : [],
        displayOrder: Number.isFinite(asset.displayOrder) ? asset.displayOrder : index,
        isPrimary: Boolean(asset.isPrimary)
      }));

      const payload = new FormData();
      payload.set("productId", productId);
      payload.set("csrfToken", csrfToken);
      payload.set("manifest", JSON.stringify(manifest));
      assetDrafts.forEach((asset) => payload.append("files", asset.file));

      const result = await uploadProductAssetAction(payload);
      if (!result.success) {
        throw new Error(result.error ?? "Failed to upload media assets.");
      }
    } finally {
      setIsUploadingAssets(false);
    }
  };

  const resetAfterCreate = () => {
    setDraft(createInitialDraft());
    setOptionGroups([createInitialOptionGroup()]);
    setAddOns([]);
    setCustomFields([]);
    setSubscriptionPlans([]);
    setJourneyComponents([]);
    clearAssetDrafts();
  };

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (draft.basePrice.trim().length === 0) {
      setFeedback({ type: "error", message: "Base price is required." });
      return;
    }

    const parsedBasePrice = Number(draft.basePrice);
    if (!Number.isFinite(parsedBasePrice)) {
      setFeedback({ type: "error", message: "Base price must be a valid number." });
      return;
    }

    const slug = draft.slug.trim();
    const title = draft.title.trim();
    const category = draft.category.trim();
    const currency = draft.currency.trim().toUpperCase() || "EUR";
    const description = draft.description.trim();
    const configuration = buildConfigurationPayload();

    const validationErrors = collectValidationErrors({
      slug,
      title,
      category,
      basePrice: parsedBasePrice
    });

    if (validationErrors.length > 0) {
      setFeedback({ type: "error", message: validationErrors.join(" ") });
      return;
    }

    const payload: Record<string, unknown> = {
      slug,
      title,
      category,
      basePrice: parsedBasePrice,
      currency,
      status: draft.status,
      description: description.length ? description : null,
      channelEligibility: draft.channelEligibility
    };

    if (configuration) {
      payload.configuration = configuration;
    }

    setIsCreating(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/products/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = await response.text();
        try {
          const parsed = JSON.parse(message) as Record<string, unknown>;
          if (typeof parsed.detail === "string") {
            message = parsed.detail;
          } else if (Array.isArray(parsed.detail)) {
            message = parsed.detail
              .map((entry) => {
                if (typeof entry === "string") {
                  return entry;
                }
                if (entry && typeof entry === "object" && "msg" in entry) {
                  return String((entry as { msg?: unknown }).msg);
                }
                return JSON.stringify(entry);
              })
              .join(", ");
          }
        } catch {
          // ignore JSON parsing errors
        }
        throw new Error(message || "Failed to create product.");
      }

      const created = (await response.json()) as { id: string };
      let assetUploadResultMessage = "";

      try {
        await uploadQueuedAssets(created.id);
        if (assetDrafts.length > 0) {
          assetUploadResultMessage = " Media assets uploaded.";
        }
      } catch (assetError) {
        const message =
          assetError instanceof Error ? assetError.message : "Product saved, but media upload failed.";
        setFeedback({ type: "error", message });
        router.refresh();
        return;
      }

      setFeedback({ type: "success", message: `Product created.${assetUploadResultMessage}`.trim() });
      resetAfterCreate();
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create product. Please try again.";
      setFeedback({ type: "error", message });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const productId = formData.get("productId");
    if (!productId) return;

    const title = formData.get("title");
    const description = formData.get("description");
    const rawBasePrice = formData.get("basePrice");
    const rawCurrency = formData.get("currency");
    const rawStatus = formData.get("status");

    let basePrice: number | undefined;
    if (typeof rawBasePrice === "string" && rawBasePrice.trim().length > 0) {
      const parsed = Number(rawBasePrice);
      if (Number.isFinite(parsed)) {
        basePrice = parsed;
      }
    }

    const payload: Record<string, unknown> = {
      title: typeof title === "string" && title.trim().length > 0 ? title.trim() : undefined,
      description:
        typeof description === "string" && description.trim().length > 0 ? description.trim() : undefined,
      basePrice,
      currency:
        typeof rawCurrency === "string" && rawCurrency.trim().length > 0
          ? rawCurrency.trim().toUpperCase()
          : undefined,
      status:
        typeof rawStatus === "string" && rawStatus.trim().length > 0
          ? rawStatus.trim().toLowerCase()
          : undefined
    };

    const res = await fetch(`${apiBase}/api/v1/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    router.refresh();
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const productId = formData.get("productId");
    if (!productId) return;
    const res = await fetch(`${apiBase}/api/v1/products/${productId}`, { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    router.refresh();
  }

  const previewOptionGroups: ConfiguratorOptionGroup[] = useMemo(() => {
    return optionGroups
      .map<ConfiguratorOptionGroup | null>((group) => {
        const sanitizedOptions = group.options
          .filter((option) => option.label.trim().length > 0)
          .map((option) => ({
            id: option.key,
            label: option.label.trim(),
            description: option.description.trim() || undefined,
            priceDelta: Number.isFinite(Number(option.priceDelta)) ? Number(option.priceDelta) : 0,
            recommended: option.recommended
          }));
        if (!group.name.trim() || sanitizedOptions.length === 0) {
          return null;
        }
        return {
          id: group.key,
          name: group.name.trim(),
          description: group.description.trim() || undefined,
          type: group.type,
          required: group.required,
          options: sanitizedOptions
        };
      })
      .filter((group): group is ConfiguratorOptionGroup => group !== null);
  }, [optionGroups]);

  const previewAddOns: ConfiguratorAddOn[] = useMemo(() => {
    return addOns
      .filter((item) => item.label.trim().length > 0)
      .map((item) => {
        const { metadata, fallbackPriceDelta } = resolveAddOnMetadata(item);
        return {
          id: item.key,
          label: item.label.trim(),
          description: item.description.trim() || undefined,
          priceDelta: fallbackPriceDelta,
          recommended: item.recommended,
          metadata
        };
      });
  }, [addOns, resolveAddOnMetadata]);

  const previewCustomFields: ConfiguratorCustomField[] = useMemo(() => {
    return customFields
      .filter((field) => field.label.trim().length > 0 && field.exposeInCheckout)
      .map((field) => {
        const validation: ConfiguratorCustomField["validation"] = {};
        const minTrimmed = field.validation.minLength.trim();
        if (minTrimmed.length > 0) {
          const parsed = Number(minTrimmed);
          if (Number.isFinite(parsed) && parsed >= 0) {
            validation.minLength = parsed;
          }
        }
        const maxTrimmed = field.validation.maxLength.trim();
        if (maxTrimmed.length > 0) {
          const parsed = Number(maxTrimmed);
          if (Number.isFinite(parsed) && parsed >= 0) {
            validation.maxLength = parsed;
          }
        }
        const patternTrimmed = field.validation.pattern.trim();
        if (patternTrimmed.length > 0) {
          validation.pattern = patternTrimmed;
        }
        const regexFlagsTrimmed = field.validation.regexFlags.trim();
        const regexDescriptionTrimmed = field.validation.regexDescription.trim();
        const regexSampleTrimmed = field.regexTester.sampleValue.trim();
        if (
          patternTrimmed.length > 0 &&
          (regexFlagsTrimmed.length > 0 || regexDescriptionTrimmed.length > 0 || regexSampleTrimmed.length > 0)
        ) {
          validation.regex = {
            pattern: patternTrimmed,
            ...(regexFlagsTrimmed.length > 0 ? { flags: regexFlagsTrimmed } : {}),
            ...(regexDescriptionTrimmed.length > 0 ? { description: regexDescriptionTrimmed } : {}),
            ...(regexSampleTrimmed.length > 0 ? { sampleValue: regexSampleTrimmed } : {})
          };
        }
        if (field.validation.disallowWhitespace) {
          validation.disallowWhitespace = true;
        }
        if (field.fieldType === "number") {
          const minValueTrimmed = field.validation.minValue.trim();
          if (minValueTrimmed.length > 0) {
            const parsed = Number(minValueTrimmed);
            if (Number.isFinite(parsed)) {
              validation.minValue = parsed;
            }
          }
          const maxValueTrimmed = field.validation.maxValue.trim();
          if (maxValueTrimmed.length > 0) {
            const parsed = Number(maxValueTrimmed);
            if (Number.isFinite(parsed)) {
              validation.maxValue = parsed;
            }
          }
          const numericStep = parseNumericString(field.validation.numericStep);
          if (numericStep != null && numericStep > 0) {
            validation.numericStep = numericStep;
          }
        }
        const allowedValues = parseDelimitedList(field.validation.allowedValues);
        if (allowedValues.length > 0) {
          validation.allowedValues = allowedValues;
        }
        const defaultTrimmed = field.defaultValue.trim();
        const serializedVisibility = serializeVisibilityDraft(field.visibility);
        const sampleValues = parseDelimitedList(field.sampleValues);
        return {
          id: field.key,
          label: field.label.trim(),
          type: field.fieldType,
          placeholder: field.placeholder.trim() || undefined,
          required: field.required,
          helpText: field.helpText.trim() || undefined,
          validation: Object.keys(validation).length > 0 ? validation : undefined,
          defaultValue: defaultTrimmed.length > 0 ? defaultTrimmed : undefined,
          conditional: serializedVisibility ?? undefined,
          sampleValues: sampleValues.length > 0 ? sampleValues : undefined,
          passthrough: field.exposeInFulfillment ? { fulfillment: true } : undefined
        } satisfies ConfiguratorCustomField;
      });
  }, [customFields, serializeVisibilityDraft]);

  const previewSubscriptionPlans = useMemo<ConfiguratorSubscriptionPlan[]>(() => {
    return subscriptionPlans
      .filter((plan) => plan.label.trim().length > 0)
      .map(
        (plan) =>
          ({
            id: plan.key,
            label: plan.label.trim(),
            description: plan.description.trim() || undefined,
            billingCycle: toConfiguratorBillingCycle(plan.billingCycle),
            priceMultiplier:
              plan.priceMultiplier.trim().length > 0 && Number.isFinite(Number(plan.priceMultiplier))
                ? Number(plan.priceMultiplier)
                : undefined,
            priceDelta:
              plan.priceDelta.trim().length > 0 && Number.isFinite(Number(plan.priceDelta))
                ? Number(plan.priceDelta)
                : undefined,
            default: plan.isDefault
          }) satisfies ConfiguratorSubscriptionPlan
      );
  }, [subscriptionPlans]);

  const blueprintOptionPreviews: OptionBlueprintPreview[] = useMemo(() => {
    return optionGroups.flatMap((group) =>
      group.options
        .filter((option) => option.label.trim().length > 0)
        .map((option) => {
          const amountValue =
            option.pricing.amount.trim().length > 0 && Number.isFinite(Number(option.pricing.amount))
              ? Number(option.pricing.amount)
              : undefined;
          const basePriceValue =
            option.pricing.basePrice.trim().length > 0 && Number.isFinite(Number(option.pricing.basePrice))
              ? Number(option.pricing.basePrice)
              : undefined;
          const unitPriceValue =
            option.pricing.unitPrice.trim().length > 0 && Number.isFinite(Number(option.pricing.unitPrice))
              ? Number(option.pricing.unitPrice)
              : undefined;
          const dripMinPerDayValue =
            option.pricing.dripMinPerDay.trim().length > 0 &&
            Number.isFinite(Number(option.pricing.dripMinPerDay))
              ? Number(option.pricing.dripMinPerDay)
              : undefined;
          const discountTiers =
            option.pricing.discountTiers.length > 0
              ? option.pricing.discountTiers
                  .map((tier) => {
                    if (
                      tier.minAmount.trim().length === 0 ||
                      tier.unitPrice.trim().length === 0 ||
                      !Number.isFinite(Number(tier.minAmount)) ||
                      !Number.isFinite(Number(tier.unitPrice))
                    ) {
                      return null;
                    }
                    return {
                      minAmount: Number(tier.minAmount),
                      unitPrice: Number(tier.unitPrice),
                      label: tier.label.trim() || null
                    };
                  })
                  .filter((tier): tier is NonNullable<typeof tier> => tier != null)
              : undefined;

          const heroCandidates = option.media.filter((attachment) => attachment.assetId.trim().length > 0);
          const heroValue = option.heroImageUrl.trim();
          const heroMatch = heroCandidates.find(
            (attachment) => attachment.assetId.trim() === heroValue
          );
          const heroSource =
            heroValue.length === 0
              ? undefined
              : heroMatch
                ? "media"
                : /^https?:\/\//i.test(heroValue) || heroValue.startsWith("data:")
                  ? "external"
                  : undefined;
          const heroLabel = heroMatch
            ? heroMatch.label.trim() || heroMatch.assetId.trim()
            : heroSource === "external"
              ? undefined
              : heroValue.length > 0
                ? heroValue
                : undefined;

          const expression = option.calculatorExpression.trim();
          const expressionValid = expression.length === 0 || isCalculatorExpressionValid(expression);
          const sampleAmount = parseNumericString(option.calculatorSampleAmount);
          const sampleDays = parseNumericString(option.calculatorSampleDays);
          const sampleResult = evaluateCalculatorExpression(expression, sampleAmount, sampleDays);

          return {
            groupName: group.name.trim() || "Untitled group",
            optionLabel: option.label.trim(),
            amount: amountValue,
            amountUnit: option.pricing.amountUnit.trim() || undefined,
            basePrice: basePriceValue,
            unitPrice: unitPriceValue,
            dripMinPerDay: dripMinPerDayValue,
            discountTiers,
            marketingTagline: option.marketingTagline.trim() || undefined,
            fulfillmentSla: option.fulfillmentSla.trim() || undefined,
            heroImageUrl: heroValue || undefined,
            heroSource,
            heroLabel,
            calculatorExpression: expression || undefined,
            calculatorSampleAmount: sampleAmount,
            calculatorSampleDays: sampleDays,
            calculatorSampleResult: sampleResult,
            calculatorExpressionValid: expressionValid
          } satisfies OptionBlueprintPreview;
        })
    );
  }, [optionGroups]);

  return (
    <>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Create product</h2>
            <p className="text-sm text-white/60">
              Generate storefront SKUs, configure variation matrices, and stage media assets before publishing.
            </p>
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Direct API passthrough</p>
        </header>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)]">
          <form onSubmit={handleCreate} className="flex flex-col gap-8">
            <section className="space-y-6 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="space-y-1">
                <h3 className="text-lg font-semibold text-white">Catalog details</h3>
                <p className="text-sm text-white/60">
                  Slug, base pricing, and channel eligibility map directly to the FastAPI product contract.
                </p>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Slug</span>
                  <input
                    required
                    name="slug"
                    value={draft.slug}
                    onChange={(event) => updateDraft("slug", event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                    placeholder="instagram-growth"
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Title</span>
                  <input
                    required
                    name="title"
                    value={draft.title}
                    onChange={(event) => updateDraft("title", event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                    placeholder="Instagram Growth Campaign"
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Category</span>
                  <input
                    required
                    name="category"
                    value={draft.category}
                    onChange={(event) => updateDraft("category", event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                    placeholder="instagram"
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Base price</span>
                  <input
                    required
                    name="basePrice"
                    type="number"
                    value={draft.basePrice}
                    onChange={(event) => updateDraft("basePrice", event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                    placeholder="299"
                    min="0"
                    step="1"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Currency</span>
                  <input
                    name="currency"
                    value={draft.currency}
                    onChange={(event) => updateDraft("currency", event.target.value.toUpperCase())}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                    placeholder="EUR"
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-white/80">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Status</span>
                  <select
                    name="status"
                    value={draft.status}
                    onChange={(event) => updateDraft("status", event.target.value as ProductDraft["status"])}
                    className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="space-y-3 text-sm text-white/80">
                <legend className="text-xs uppercase tracking-[0.3em] text-white/40">Eligible channels</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CHANNEL_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        name="channelEligibility"
                        value={option.value}
                        checked={draft.channelEligibility.includes(option.value)}
                        onChange={() => handleChannelToggle(option.value)}
                        className="h-4 w-4 rounded border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-white/50">
                  Channels determine where the product can be sold (storefront, loyalty flows, referrals, or dashboard).
                </p>
              </fieldset>

              <label className="flex flex-col gap-2 text-sm text-white/80">
                <span className="text-xs uppercase tracking-[0.3em] text-white/40">Description</span>
                <textarea
                  name="description"
                  rows={3}
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                  className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none"
                  placeholder="Outline deliverables, delivery speed, and requirements."
                />
              </label>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-white">Variation matrix</h3>
                <p className="text-sm text-white/60">
                  Define option groups that shoppers will choose during checkout (e.g., platform, package size).
                </p>
              </header>
              <div className="space-y-4">
                {optionGroups.map((group, groupIndex) => (
                  <div key={group.key} className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-1 flex-col gap-2 text-sm text-white/80">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Group name</span>
                          <input
                            value={group.name}
                            onChange={(event) => updateGroup(group.key, "name", event.target.value)}
                            placeholder={`Group ${groupIndex + 1}`}
                            className="rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Description</span>
                          <input
                            value={group.description}
                            onChange={(event) => updateGroup(group.key, "description", event.target.value)}
                            placeholder="Explain the choice presented to operators."
                            className="rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/60">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`group-type-${group.key}`}
                            value="single"
                            checked={group.type === "single"}
                            onChange={() => updateGroup(group.key, "type", "single")}
                            className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                          />
                          Single choice
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`group-type-${group.key}`}
                            value="multiple"
                            checked={group.type === "multiple"}
                            onChange={() => updateGroup(group.key, "type", "multiple")}
                            className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                          />
                          Multi select
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={group.required}
                            onChange={(event) => updateGroup(group.key, "required", event.target.checked)}
                            className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                          />
                          Required
                        </label>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {group.options.map((option, optionIndex) => {
                        const heroCandidates = option.media.filter(
                          (attachment) => attachment.assetId.trim().length > 0
                        );
                        const heroValue = option.heroImageUrl.trim();
                        const heroMatchesCandidate = heroCandidates.find(
                          (attachment) => attachment.assetId.trim() === heroValue
                        );
                        const heroLooksExternal =
                          heroValue.length > 0 &&
                          (/^https?:\/\//i.test(heroValue) || heroValue.startsWith("data:"));
                        const heroHasWarning =
                          heroValue.length > 0 && !heroLooksExternal && !heroMatchesCandidate;
                        const calculatorExpression = option.calculatorExpression.trim();
                        const calculatorExpressionInvalid =
                          calculatorExpression.length > 0 && !isCalculatorExpressionValid(calculatorExpression);
                        const sampleAmount = parseNumericString(option.calculatorSampleAmount);
                        const sampleDays = parseNumericString(option.calculatorSampleDays);
                        const calculatorSampleResult = evaluateCalculatorExpression(
                          calculatorExpression,
                          sampleAmount,
                          sampleDays
                        );

                        return (
                          <div
                            key={option.key}
                            className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4"
                          >
                            <div className="text-xs uppercase tracking-[0.3em] text-white/40">
                              Option {optionIndex + 1}
                            </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Label
                              <input
                                value={option.label}
                                onChange={(event) => updateOption(group.key, option.key, "label", event.target.value)}
                                placeholder="Premium package"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Description
                              <input
                                value={option.description}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "description", event.target.value)
                                }
                                placeholder="Highlight key deliverables"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                          </div>
                          <div className="grid gap-3 md:grid-cols-4">
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Amount
                              <input
                                type="number"
                                min="0"
                                value={option.pricing.amount}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "pricing", {
                                    ...option.pricing,
                                    amount: event.target.value
                                  })
                                }
                                placeholder="1000"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Amount unit
                              <input
                                value={option.pricing.amountUnit}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "pricing", {
                                    ...option.pricing,
                                    amountUnit: event.target.value
                                  })
                                }
                                placeholder="followers"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Base price
                              <input
                                type="number"
                                min="0"
                                value={option.pricing.basePrice}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "pricing", {
                                    ...option.pricing,
                                    basePrice: event.target.value
                                  })
                                }
                                placeholder="799"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Unit price
                              <input
                                type="number"
                                min="0"
                                value={option.pricing.unitPrice}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "pricing", {
                                    ...option.pricing,
                                    unitPrice: event.target.value
                                  })
                                }
                                placeholder="0.80"
                                step="0.01"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Price delta
                              <input
                                value={option.priceDelta}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "priceDelta", event.target.value)
                                }
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                type="number"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Drip minimum per day
                              <input
                                type="number"
                                min="0"
                                value={option.pricing.dripMinPerDay}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "pricing", {
                                    ...option.pricing,
                                    dripMinPerDay: event.target.value
                                  })
                                }
                                placeholder="150"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                              <input
                                type="checkbox"
                                checked={option.recommended}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "recommended", event.target.checked)
                                }
                                className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                              />
                              Recommended
                            </label>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Marketing tagline
                              <input
                                value={option.marketingTagline}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "marketingTagline", event.target.value)
                                }
                                placeholder="100 Followers / €3"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Fulfillment SLA
                              <input
                                value={option.fulfillmentSla}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "fulfillmentSla", event.target.value)
                                }
                                placeholder="Delivery within 5 days"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Hero image URL
                              <input
                                value={option.heroImageUrl}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "heroImageUrl", event.target.value)
                                }
                                placeholder="https://cdn.example.com/bundle.png"
                                className={`rounded-lg border px-3 py-1.5 text-white focus:outline-none ${
                                  heroHasWarning
                                    ? "border-amber-400/60 bg-amber-500/10 focus:border-amber-400/80"
                                    : "border-white/10 bg-black/50 focus:border-white/40"
                                }`}
                              />
                              {heroCandidates.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem]">
                                  {heroCandidates.map((attachment) => {
                                    const candidateValue = attachment.assetId.trim();
                                    const isActive = candidateValue.length > 0 && candidateValue === heroValue;
                                    return (
                                      <button
                                        key={attachment.key}
                                        type="button"
                                        onClick={() =>
                                          updateOption(group.key, option.key, "heroImageUrl", candidateValue)
                                        }
                                        className={`rounded-full border px-3 py-1 uppercase tracking-[0.25em] transition ${
                                          isActive
                                            ? "border-white/70 bg-white/20 text-white"
                                            : "border-white/20 text-white/70 hover:border-white/40 hover:text-white"
                                        }`}
                                      >
                                        Use {attachment.label.trim() || attachment.assetId.trim()}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {heroHasWarning ? (
                                <p className="mt-2 text-[0.65rem] text-amber-200">
                                  Provide a full URL or select one of the option media asset IDs above.
                                </p>
                              ) : heroMatchesCandidate ? (
                                <p className="mt-2 text-[0.65rem] text-white/50">
                                  Using option media asset <code>{heroMatchesCandidate.assetId}</code>.
                                </p>
                              ) : heroLooksExternal ? (
                                <p className="mt-2 text-[0.65rem] text-white/50">External hero image detected.</p>
                              ) : null}
                            </label>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs uppercase tracking-[0.3em] text-white/40">Discount tiers</span>
                              <button
                                type="button"
                                onClick={() => addDiscountTier(group.key, option.key)}
                                className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                              >
                                Add tier
                              </button>
                            </div>
                            {option.pricing.discountTiers.length === 0 ? (
                              <p className="text-xs text-white/50">No discount tiers defined.</p>
                            ) : (
                              option.pricing.discountTiers.map((tier, tierIndex) => (
                                <div
                                  key={tier.key}
                                  className="grid gap-2 rounded-lg border border-white/10 bg-black/40 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                                >
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Min amount
                                    <input
                                      type="number"
                                      min="0"
                                      value={tier.minAmount}
                                      onChange={(event) =>
                                        updateDiscountTier(
                                          group.key,
                                          option.key,
                                          tier.key,
                                          "minAmount",
                                          event.target.value
                                        )
                                      }
                                      placeholder="2000"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Unit price
                                    <input
                                      type="number"
                                      min="0"
                                      value={tier.unitPrice}
                                      onChange={(event) =>
                                        updateDiscountTier(
                                          group.key,
                                          option.key,
                                          tier.key,
                                          "unitPrice",
                                          event.target.value
                                        )
                                      }
                                      placeholder="0.75"
                                      step="0.01"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Label
                                    <input
                                      value={tier.label}
                                      onChange={(event) =>
                                        updateDiscountTier(
                                          group.key,
                                          option.key,
                                          tier.key,
                                          "label",
                                          event.target.value
                                        )
                                      }
                                      placeholder="Scale 2k+"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => removeDiscountTier(group.key, option.key, tier.key)}
                                    className="self-center rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                                    aria-label={`Remove discount tier ${tierIndex + 1}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs uppercase tracking-[0.3em] text-white/40">Variation media</span>
                              <button
                                type="button"
                                onClick={() => addOptionMedia(group.key, option.key)}
                                className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                              >
                                Add asset
                              </button>
                            </div>
                            {option.media.length === 0 ? (
                              <p className="text-xs text-white/50">No assets linked to this variation.</p>
                            ) : (
                              option.media.map((attachment, attachmentIndex) => (
                                <div
                                  key={attachment.key}
                                  className="grid gap-2 rounded-lg border border-white/10 bg-black/40 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                                >
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Asset ID
                                    <input
                                      value={attachment.assetId}
                                      onChange={(event) =>
                                        updateOptionMedia(
                                          group.key,
                                          option.key,
                                          attachment.key,
                                          "assetId",
                                          event.target.value
                                        )
                                      }
                                      placeholder="asset-uuid"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Usage
                                    <input
                                      value={attachment.usage}
                                      onChange={(event) =>
                                        updateOptionMedia(
                                          group.key,
                                          option.key,
                                          attachment.key,
                                          "usage",
                                          event.target.value
                                        )
                                      }
                                      placeholder="hero | gallery"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Label
                                    <input
                                      value={attachment.label}
                                      onChange={(event) =>
                                        updateOptionMedia(
                                          group.key,
                                          option.key,
                                          attachment.key,
                                          "label",
                                          event.target.value
                                        )
                                      }
                                      placeholder="Hero render"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => removeOptionMedia(group.key, option.key, attachment.key)}
                                    className="self-center rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                                    aria-label={`Remove asset ${attachmentIndex + 1}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Calculator expression
                              <input
                                value={option.calculatorExpression}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "calculatorExpression", event.target.value)
                                }
                                placeholder="amount / days"
                                className={`rounded-lg border px-3 py-1.5 text-white focus:outline-none ${
                                  calculatorExpressionInvalid
                                    ? "border-red-400/60 bg-red-500/10 focus:border-red-400/80"
                                    : "border-white/10 bg-black/50 focus:border-white/40"
                                }`}
                              />
                              {calculatorExpressionInvalid ? (
                                <p className="mt-1 text-[0.65rem] text-red-200">
                                  Expression can only use numbers, <code>amount</code>, <code>days</code>, and + - * /.
                                </p>
                              ) : calculatorSampleResult != null ? (
                                <p className="mt-1 text-[0.65rem] text-white/50">
                                  Sample output: {calculatorSampleResult.toFixed(2)}
                                </p>
                              ) : null}
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Sample amount
                              <input
                                value={option.calculatorSampleAmount}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "calculatorSampleAmount", event.target.value)
                                }
                                placeholder="100"
                                type="number"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                              Sample days
                              <input
                                value={option.calculatorSampleDays}
                                onChange={(event) =>
                                  updateOption(group.key, option.key, "calculatorSampleDays", event.target.value)
                                }
                                placeholder="30"
                                type="number"
                                className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              />
                            </label>
                          </div>
                          <p className="text-[0.65rem] text-white/40">
                            Use variables <code>amount</code> and <code>days</code> with +, -, *, / to compute short descriptions.
                          </p>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(group.key, option.key)}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white"
                            >
                              Remove
                            </button>
                          </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => handleAddOption(group.key)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                      >
                        Add option
                      </button>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveGroup(group.key)}
                        className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                      >
                        Remove group
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddGroup}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80"
              >
                Add option group
              </button>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-white">Add-ons</h3>
                <p className="text-sm text-white/60">
                  Upsell optional services or fulfillment extras. These surface as independent toggles.
                </p>
              </header>
              <div className="space-y-3">
                {addOns.map((item) => {
                  const selectedProvider = providerCatalog.find((provider) => provider.id === item.pricing.providerId);
                  const selectedService = selectedProvider?.services.find((service) => service.id === item.pricing.serviceId);
                  const previewCurrency =
                    item.pricing.costCurrency ||
                    selectedService?.metadata.costModel?.currency ||
                    selectedService?.metadata.guardrails?.currency ||
                    selectedService?.defaultCurrency ||
                    draft.currency ||
                    "USD";
                  const resolvedPreviewQuantity =
                    safePositiveNumber(item.pricing.previewQuantity) ??
                    (typeof selectedService?.metadata.defaultInputs?.quantity === "number"
                      ? selectedService.metadata.defaultInputs.quantity
                      : undefined) ??
                    1;
                  const providerCostPreview = selectedService
                    ? estimateProviderCost(selectedService.metadata.costModel, resolvedPreviewQuantity)
                    : null;
                  const customerPricePreview =
                    parseNumericString(item.pricing.amount) ?? parseNumericString(item.priceDelta);
                  const marginPreview: ReturnType<typeof evaluateMargin> = selectedService
                    ? evaluateMargin(selectedService.metadata.guardrails, providerCostPreview, customerPricePreview)
                    : { status: "idle", marginValue: null, marginPercent: null };
                  const marginStyle = getAddOnMarginStatusStyle(marginPreview.status);
                  const costSummary = selectedService
                    ? describeCostModel(selectedService.metadata.costModel, previewCurrency)
                    : [];
                  const guardrailSummary = selectedService
                    ? describeGuardrails(selectedService.metadata.guardrails, previewCurrency)
                    : [];
                  const cadenceSummary = selectedService
                    ? describeCadence(selectedService.metadata.cadence)
                    : [];
                  return (
                  <div key={item.key} className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Label
                        <input
                          value={item.label}
                          onChange={(event) => updateAddOn(item.key, "label", event.target.value)}
                          placeholder="Paid amplification boost"
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Description
                        <input
                          value={item.description}
                          onChange={(event) => updateAddOn(item.key, "description", event.target.value)}
                          placeholder="Managed spend with weekly reporting"
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Fallback price delta
                        <input
                          value={item.priceDelta}
                          onChange={(event) => updateAddOn(item.key, "priceDelta", event.target.value)}
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                          type="number"
                        />
                        <span className="text-[0.65rem] text-white/40">Used if advanced pricing cannot apply.</span>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Pricing mode
                        <select
                          value={item.pricing.mode}
                          onChange={(event) =>
                            updateAddOnPricing(item.key, {
                              mode: event.target.value as AddOnPricingDraft["mode"],
                              ...(event.target.value !== "serviceOverride" ? { serviceId: "" } : {})
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        >
                          <option value="flat">Flat fee</option>
                          <option value="percentage">Percentage of subtotal</option>
                          <option value="serviceOverride">Service override</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        {item.pricing.mode === "percentage"
                          ? "Percentage (e.g. 0.15)"
                          : item.pricing.mode === "serviceOverride"
                            ? "Override amount (optional)"
                            : "Flat amount"}
                        <input
                          value={item.pricing.amount}
                          onChange={(event) => updateAddOnPricing(item.key, { amount: event.target.value })}
                          placeholder={item.pricing.mode === "percentage" ? "0.15" : "120"}
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                          type="number"
                        />
                      </label>
                    </div>
                    {item.pricing.mode === "serviceOverride" ? (
                      <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Fulfillment provider
                            <select
                              value={item.pricing.providerId}
                              onChange={(event) => {
                                const nextProviderId = event.target.value;
                                const provider = resolveProviderById(nextProviderId);
                                const nextServiceId = provider?.services[0]?.id ?? "";
                                const nextPricing: AddOnPricingDraft = {
                                  ...item.pricing,
                                  providerId: nextProviderId,
                                  serviceId: nextServiceId,
                                };
                                updateAddOnPricing(item.key, {
                                  providerId: nextProviderId,
                                  serviceId: nextServiceId,
                                });
                                const descriptor =
                                  provider?.services.find((service) => service.id === nextServiceId);
                                if (descriptor) {
                                  applyServiceDefaults(item.key, nextPricing, descriptor);
                                }
                              }}
                              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                            >
                              <option value="">Select provider</option>
                              {providerCatalog.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Provider service
                            <select
                              value={item.pricing.serviceId}
                              onChange={(event) => {
                                const nextServiceId = event.target.value;
                                const nextPricing: AddOnPricingDraft = {
                                  ...item.pricing,
                                  serviceId: nextServiceId,
                                };
                                updateAddOnPricing(item.key, { serviceId: nextServiceId });
                                const descriptor = resolveServiceById(nextPricing.providerId, nextServiceId);
                                if (descriptor) {
                                  applyServiceDefaults(item.key, nextPricing, descriptor);
                                }
                              }}
                              disabled={!item.pricing.providerId || isLoadingProviders}
                              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <option value="">Select service</option>
                              {providerCatalog
                                .find((provider) => provider.id === item.pricing.providerId)
                                ?.services.map((service) => (
                                  <option key={service.id} value={service.id}>
                                    {service.name} ({service.action})
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Override service ID
                            <input
                              value={item.pricing.serviceId}
                              onChange={(event) => updateAddOnPricing(item.key, { serviceId: event.target.value })}
                              placeholder="svc_123"
                              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Provider cost
                            <input
                              value={item.pricing.costAmount}
                              onChange={(event) => updateAddOnPricing(item.key, { costAmount: event.target.value })}
                              placeholder="100"
                              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              type="number"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Cost currency
                            <input
                              value={item.pricing.costCurrency}
                              onChange={(event) => updateAddOnPricing(item.key, { costCurrency: event.target.value })}
                              placeholder="USD"
                              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 uppercase text-white focus:border-white/40 focus:outline-none"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Margin target (%)
                            <input
                              value={item.pricing.marginTarget}
                              onChange={(event) => updateAddOnPricing(item.key, { marginTarget: event.target.value })}
                              placeholder="25"
                              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              type="number"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Fulfillment mode
                            <select
                              value={item.pricing.fulfillmentMode}
                              onChange={(event) =>
                                updateAddOnPricing(item.key, {
                                  fulfillmentMode: event.target.value as AddOnPricingDraft["fulfillmentMode"],
                                })
                              }
                              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                            >
                              <option value="immediate">Immediate</option>
                              <option value="scheduled">Scheduled</option>
                              <option value="refill">Refill</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Drip per day
                            <input
                              value={item.pricing.dripPerDay}
                              onChange={(event) => updateAddOnPricing(item.key, { dripPerDay: event.target.value })}
                              placeholder="20"
                              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                              type="number"
                            />
                          </label>
                        </div>
                        <label className="flex flex-col gap-1 text-xs text-white/70">
                          Provider payload template (JSON)
                          <textarea
                            value={item.pricing.payloadTemplate}
                            onChange={(event) => updateAddOnPricing(item.key, { payloadTemplate: event.target.value })}
                            placeholder='{"amount":"{{quantity}}","geo":"EU"}'
                            rows={3}
                            className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-[0.75rem] text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                        {selectedService ? (
                          <div className="space-y-3 rounded-xl border border-white/15 bg-black/20 p-3 text-white/80">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                                  Fulfillment blueprint preview
                                </p>
                                <p className="text-sm font-semibold text-white">{selectedService.name}</p>
                                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                                  {(selectedProvider?.name ?? selectedService.providerId).toUpperCase()} ·{" "}
                                  {selectedService.action}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => applyServiceDefaults(item.key, item.pricing, selectedService, { force: true })}
                                className="rounded-full border border-emerald-400/30 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-400/60 hover:text-emerald-100"
                              >
                                Apply provider defaults
                              </button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                              <label className="flex flex-col gap-1 text-xs text-white/70">
                                Preview quantity
                                <input
                                  value={item.pricing.previewQuantity}
                                  onChange={(event) =>
                                    updateAddOnPricing(item.key, { previewQuantity: event.target.value })
                                  }
                                  placeholder={
                                    selectedService.metadata.defaultInputs?.quantity != null
                                      ? String(selectedService.metadata.defaultInputs.quantity)
                                      : "100"
                                  }
                                  type="number"
                                  min="0"
                                  className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                />
                                <span className="text-[0.65rem] text-white/40">
                                  Used for provider cost + guardrail calculations.
                                </span>
                              </label>
                              <div className={`rounded-2xl border px-4 py-2 ${marginStyle.border} bg-black/30`}>
                                <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Margin preview</p>
                                <p className="text-sm text-white">
                                  Provider cost:{" "}
                                  {providerCostPreview != null
                                    ? formatServiceCurrency(providerCostPreview, previewCurrency)
                                    : "—"}
                                </p>
                                <p className={`text-xs ${marginStyle.text}`}>
                                  {marginPreview.status === "idle"
                                    ? "Enter a customer price to evaluate guardrails."
                                    : `${formatServiceCurrency(marginPreview.marginValue ?? 0, previewCurrency)} margin (${marginPreview.marginPercent?.toFixed(1) ?? "0.0"}%) · ${marginStyle.label}`}
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-3 text-xs text-white/70 md:grid-cols-3">
                              {costSummary.length ? (
                                <div>
                                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Cost structure</p>
                                  <ul className="mt-1 space-y-1 text-white/80">
                                    {costSummary.map((line, index) => (
                                      <li key={`cost-${item.key}-${index}`}>{line}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {guardrailSummary.length ? (
                                <div>
                                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Guardrails</p>
                                  <ul className="mt-1 space-y-1 text-white/80">
                                    {guardrailSummary.map((line, index) => (
                                      <li key={`guardrail-${item.key}-${index}`}>{line}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {cadenceSummary.length ? (
                                <div>
                                  <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Cadence</p>
                                  <ul className="mt-1 space-y-1 text-white/80">
                                    {cadenceSummary.map((line, index) => (
                                      <li key={`cadence-${item.key}-${index}`}>{line}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {!costSummary.length && !guardrailSummary.length && !cadenceSummary.length ? (
                                <p className="text-white/50">Provider metadata does not expose cost/cadence hints yet.</p>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-white/50">
                            Select a provider service to preview fulfillment guardrails and cadence.
                          </p>
                        )}
                        <p className="text-[0.65rem] text-white/40">
                          Select a provider + service to drive downstream automation. Costs feed margin reporting, and
                          payload templates let you define the request body (supports handlebars-style placeholders such as
                          <code>&nbsp;&#123;&#123;quantity&#125;&#125;</code>).
                        </p>
                        <ServiceRulesEditor
                          addOnKey={item.key}
                          rules={item.pricing.rules}
                          providers={providerCatalog}
                          onAddRule={addServiceRule}
                          onUpdateRule={updateServiceRule}
                          onRemoveRule={removeServiceRule}
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center justify-end gap-3">
                      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                        <input
                          type="checkbox"
                          checked={item.recommended}
                          onChange={(event) => updateAddOn(item.key, "recommended", event.target.checked)}
                          className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                        />
                        Recommended
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveAddOn(item.key)}
                        className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
                })}
              </div>
              <button
                type="button"
                onClick={handleAddOn}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Add add-on
              </button>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-white">Subscription plans</h3>
                <p className="text-sm text-white/60">
                  Offer recurring or bundled pricing tiers. Multipliers apply to the base price, deltas add/subtract a fixed amount.
                </p>
              </header>
              <div className="space-y-3">
                {subscriptionPlans.map((plan) => (
                  <div
                    key={plan.key}
                    className="grid gap-3 rounded-xl border border-white/10 bg-black/40 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_auto]"
                  >
                    <label className="flex flex-col gap-1 text-xs text-white/70">
                      Label
                      <input
                        value={plan.label}
                        onChange={(event) => updateSubscriptionPlan(plan.key, "label", event.target.value)}
                        placeholder="Quarterly retainer"
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/70">
                      Description
                      <input
                        value={plan.description}
                        onChange={(event) => updateSubscriptionPlan(plan.key, "description", event.target.value)}
                        placeholder="Refresh creative every quarter"
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/70">
                      Billing cycle
                      <select
                        value={plan.billingCycle}
                        onChange={(event) =>
                          updateSubscriptionPlan(plan.key, "billingCycle", event.target.value as SubscriptionPlanDraft["billingCycle"])
                        }
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      >
                        <option value="one_time">One-time</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/70">
                      Multiplier
                      <input
                        value={plan.priceMultiplier}
                        onChange={(event) => updateSubscriptionPlan(plan.key, "priceMultiplier", event.target.value)}
                        placeholder="1"
                        type="number"
                        step="0.01"
                        min="0"
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/70">
                      Delta
                      <input
                        value={plan.priceDelta}
                        onChange={(event) => updateSubscriptionPlan(plan.key, "priceDelta", event.target.value)}
                        placeholder="0"
                        type="number"
                        step="1"
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      />
                    </label>
                    <div className="col-span-full flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-white/60">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="subscription-default"
                          checked={plan.isDefault}
                          onChange={() => handleToggleDefaultPlan(plan.key)}
                          className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                        />
                        Default plan
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubscriptionPlan(plan.key)}
                        className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                      >
                        Remove plan
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddSubscriptionPlan}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Add subscription plan
              </button>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-white">Custom intake fields</h3>
                <p className="text-sm text-white/60">
                  Collect product-specific requirements (links, briefs, numeric guardrails) before hand-off.
                </p>
              </header>
              <div className="space-y-3">
                {customFields.map((field) => {
                  const availableOptionGroups = optionGroups.filter((group) => group.options.length > 0);
                  const canAddOptionCondition = availableOptionGroups.length > 0;
                  const canAddAddOnCondition = addOns.length > 0;
                  const canAddPlanCondition = subscriptionPlans.length > 0;
                  const canAddChannelCondition = CHANNEL_OPTIONS.length > 0;

                  return (
                    <div key={field.key} className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <label className="flex flex-col gap-1 text-xs text-white/70">
                          Label
                          <input
                            value={field.label}
                            onChange={(event) => updateCustomField(field.key, "label", event.target.value)}
                            placeholder="Instagram handle"
                            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-white/70">
                          Placeholder
                          <input
                            value={field.placeholder}
                            onChange={(event) => updateCustomField(field.key, "placeholder", event.target.value)}
                            placeholder="@brand"
                            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-white/70">
                          Help text
                          <input
                            value={field.helpText}
                            onChange={(event) => updateCustomField(field.key, "helpText", event.target.value)}
                            placeholder="Used to populate creative briefs."
                            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                          />
                        </label>
                        <div className="flex items-center justify-end gap-3">
                          <select
                            value={field.fieldType}
                            onChange={(event) =>
                              updateCustomField(field.key, "fieldType", event.target.value as CustomFieldDraft["fieldType"])
                            }
                            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                          >
                            <option value="text">Text</option>
                            <option value="url">URL</option>
                            <option value="number">Number</option>
                          </select>
                          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) => updateCustomField(field.key, "required", event.target.checked)}
                              className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                            />
                            Required
                          </label>
                        </div>
                      </div>
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Default value
                        <input
                          value={field.defaultValue}
                          onChange={(event) => updateCustomField(field.key, "defaultValue", event.target.value)}
                          placeholder={field.fieldType === "number" ? "e.g. 10" : "Optional default"}
                          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        />
                        <span className="text-[0.65rem] text-white/40">
                          Applied automatically when operators leave the field blank.
                        </span>
                      </label>
                      <FieldValidationPanel
                        field={field}
                        onValidationChange={(patch) => updateCustomFieldValidation(field.key, patch)}
                        onSampleValuesChange={(value) => updateCustomField(field.key, "sampleValues", value)}
                        onRegexTesterChange={(patch) => updateRegexTester(field.key, patch)}
                      />
                      <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                            Visibility rules
                          </p>
                          <select
                            value={field.visibility.mode}
                            onChange={(event) =>
                              setFieldVisibilityMode(field.key, event.target.value as CustomFieldVisibilityDraft["mode"])
                            }
                            className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                          >
                            <option value="all">Match all</option>
                            <option value="any">Match any</option>
                          </select>
                        </div>
                        {field.visibility.conditions.length > 0 ? (
                          <div className="space-y-2">
                            {field.visibility.conditions.map((condition) => {
                              const selectedGroup =
                                condition.kind === "option"
                                  ? optionGroups.find((group) => group.key === condition.groupKey)
                                  : undefined;
                              const groupOptions = selectedGroup?.options ?? [];
                              return (
                                <div key={condition.key} className="flex flex-wrap items-center gap-2">
                                  <select
                                    value={condition.kind}
                                    onChange={(event) =>
                                      setFieldVisibilityConditionKind(
                                        field.key,
                                        condition.key,
                                        event.target.value as FieldVisibilityConditionDraft["kind"]
                                      )
                                    }
                                    className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                  >
                                    <option value="option">Option selected</option>
                                    <option value="addOn">Add-on selected</option>
                                    <option value="subscriptionPlan">Plan selected</option>
                                    <option value="channel">Channel</option>
                                  </select>
                                  {condition.kind === "option" && (
                                    <>
                                      <select
                                        value={condition.groupKey}
                                        onChange={(event) => {
                                          const nextGroupKey = event.target.value;
                                          const nextGroup = optionGroups.find((group) => group.key === nextGroupKey);
                                          const nextOptionKey = nextGroup?.options[0]?.key ?? "";
                                          updateFieldVisibilityCondition(field.key, condition.key, {
                                            groupKey: nextGroupKey,
                                            optionKey: nextOptionKey
                                          });
                                        }}
                                        className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                      >
                                        {availableOptionGroups.length > 0 ? (
                                          availableOptionGroups.map((group) => (
                                            <option key={group.key} value={group.key}>
                                              {group.name.trim() || "Option group"}
                                            </option>
                                          ))
                                        ) : (
                                          <option value="">No option groups</option>
                                        )}
                                      </select>
                                      <select
                                        value={condition.optionKey}
                                        onChange={(event) =>
                                          updateFieldVisibilityCondition(field.key, condition.key, {
                                            optionKey: event.target.value
                                          })
                                        }
                                        className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                      >
                                        {groupOptions.length > 0 ? (
                                          groupOptions.map((option) => (
                                            <option key={option.key} value={option.key}>
                                              {option.label.trim() || "Option"}
                                            </option>
                                          ))
                                        ) : (
                                          <option value="">No options</option>
                                        )}
                                      </select>
                                    </>
                                  )}
                                  {condition.kind === "addOn" && (
                                    <select
                                      value={condition.addOnKey}
                                      onChange={(event) =>
                                        updateFieldVisibilityCondition(field.key, condition.key, {
                                          addOnKey: event.target.value
                                        })
                                      }
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                    >
                                      {addOns.length > 0 ? (
                                        addOns.map((item) => (
                                          <option key={item.key} value={item.key}>
                                            {item.label.trim() || "Add-on"}
                                          </option>
                                        ))
                                      ) : (
                                        <option value="">No add-ons</option>
                                      )}
                                    </select>
                                  )}
                                  {condition.kind === "subscriptionPlan" && (
                                    <select
                                      value={condition.planKey}
                                      onChange={(event) =>
                                        updateFieldVisibilityCondition(field.key, condition.key, {
                                          planKey: event.target.value
                                        })
                                      }
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                    >
                                      {subscriptionPlans.length > 0 ? (
                                        subscriptionPlans.map((plan) => (
                                          <option key={plan.key} value={plan.key}>
                                            {plan.label.trim() || "Plan"}
                                          </option>
                                        ))
                                      ) : (
                                        <option value="">No plans</option>
                                      )}
                                    </select>
                                  )}
                                  {condition.kind === "channel" && (
                                    <select
                                      value={condition.channel}
                                      onChange={(event) =>
                                        updateFieldVisibilityCondition(field.key, condition.key, {
                                          channel: event.target.value
                                        })
                                      }
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white focus:border-white/40 focus:outline-none"
                                    >
                                      {CHANNEL_OPTIONS.map((channelOption) => (
                                        <option key={channelOption.value} value={channelOption.value}>
                                          {channelOption.label}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeFieldVisibilityCondition(field.key, condition.key)}
                                    className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white"
                                  >
                                    Remove
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-white/50">Field is visible for all configurations.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canAddOptionCondition}
                            onClick={() => addFieldVisibilityCondition(field.key, "option")}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                          >
                            Require option
                          </button>
                          <button
                            type="button"
                            disabled={!canAddAddOnCondition}
                            onClick={() => addFieldVisibilityCondition(field.key, "addOn")}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                          >
                            Require add-on
                          </button>
                          <button
                            type="button"
                            disabled={!canAddPlanCondition}
                            onClick={() => addFieldVisibilityCondition(field.key, "subscriptionPlan")}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                          >
                            Require plan
                          </button>
                          <button
                            type="button"
                            disabled={!canAddChannelCondition}
                            onClick={() => addFieldVisibilityCondition(field.key, "channel")}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                          >
                            Restrict by channel
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-white/60">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={field.exposeInCheckout}
                              onChange={(event) => updateCustomField(field.key, "exposeInCheckout", event.target.checked)}
                              className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                            />
                            Show in checkout
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={field.exposeInFulfillment}
                              onChange={(event) =>
                                updateCustomField(field.key, "exposeInFulfillment", event.target.checked)
                              }
                              className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                            />
                            Pass to fulfillment
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomField(field.key)}
                          className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/60 transition hover:border-white/40 hover:text-white"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleAddCustomField}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              >
                Add custom field
              </button>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-white">Journey components</h3>
                <p className="text-sm text-white/60">
                  Attach reusable scripts that run before checkout, during automation, or inside operator tooling. Bindings map component inputs to product data or static values.
                </p>
              </header>
              {journeyCatalog.length === 0 ? (
                <p className="text-sm text-white/50">
                  No journey component definitions are available yet. Use the FastAPI surface to register components before attaching them here.
                </p>
              ) : (
                <>
                  {journeyComponents.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Filter assignments
                        <input
                          type="search"
                          value={journeyAssignmentQuery}
                          onChange={(event) => setJourneyAssignmentQuery(event.target.value)}
                          placeholder="Search by name, script, channel, or metadata"
                          className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-white/70">
                        Stage filter
                        <select
                          value={journeyAssignmentStage}
                          onChange={(event) =>
                            setJourneyAssignmentStage(
                              event.target.value as JourneyComponentStage | "all",
                            )
                          }
                          className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        >
                          {JOURNEY_STAGE_FILTERS.map((option) => (
                            <option key={`journey-stage-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {journeyComponents.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                      <p>
                        Showing {filteredJourneyComponents.length} of {journeyComponents.length} assignment
                        {journeyComponents.length === 1 ? "" : "s"}
                      </p>
                      {hasActiveJourneyAssignmentFilters ? (
                        <button
                          type="button"
                          onClick={() => {
                            setJourneyAssignmentQuery("");
                            setJourneyAssignmentStage("all");
                          }}
                          className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white"
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {journeyComponents.length === 0 ? (
                    <p className="text-sm text-white/60">
                      No journey components attached. Add one below to expose scripted steps inside operator and checkout flows.
                    </p>
                  ) : filteredJourneyComponents.length === 0 ? (
                    <p className="text-sm text-white/60">
                      No journey components match the current filters. Adjust the filters to continue editing.
                    </p>
                  ) : (
                    <div className="space-y-4">
                  {filteredJourneyComponents.map((component) => {
                    const definition = journeyComponentLookup.get(component.componentId);
                    const metadataInput = component.metadataJson.trim();
                    let metadataError: string | null = null;
                  if (metadataInput.length > 0) {
                    try {
                      const parsed = JSON.parse(metadataInput);
                      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                        metadataError = "Metadata must be a JSON object.";
                      }
                    } catch {
                      metadataError = "Metadata must be valid JSON.";
                    }
                  }
                  const selectedChannels = parseChannelEligibilityValue(component.channelEligibility);
                  const channelDraftValue = channelInputDrafts[component.key] ?? "";
                  const pendingChannelTokens = parseChannelEligibilityValue(channelDraftValue);
                  const canAddChannel = pendingChannelTokens.length > 0;
                  const channelDatalistId = `journey-channel-options-${component.key}`;
                  const absoluteIndex = journeyComponents.findIndex((entry) => entry.key === component.key);
                  const isFirstComponent = absoluteIndex === 0;
                  const isLastComponent = absoluteIndex === journeyComponents.length - 1;
                  const healthKey = component.id ?? component.componentId;
                  const componentHealth = journeyComponentHealthMap.get(healthKey) ?? null;
                  const healthState = resolveJourneyComponentHealthState(componentHealth);
                  const healthBadge = getJourneyComponentHealthBadgeStyles(healthState);
                  const healthDescription = describeJourneyComponentHealth(componentHealth);
                  const previewState = journeyPreviewStates[component.key];
                  const canRunPreview =
                    Boolean(hasExistingProduct && activeProductId && component.id && component.componentId);
                  return (
                      <div key={component.key} className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                              Component {absoluteIndex + 1}
                            </span>
                            {healthDescription ? (
                              <p className="text-[0.6rem] text-white/40">{healthDescription}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] ${healthBadge.border} ${healthBadge.text}`}
                            >
                              {healthBadge.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => moveJourneyComponent(component.key, "up")}
                              disabled={isFirstComponent}
                              className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              Move up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveJourneyComponent(component.key, "down")}
                              disabled={isLastComponent}
                              className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              Move down
                            </button>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Component definition
                            <select
                              value={component.componentId}
                              onChange={(event) => updateJourneyComponent(component.key, "componentId", event.target.value)}
                              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                            >
                              <option value="">Select component</option>
                              {journeyCatalog.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name}
                                </option>
                              ))}
                            </select>
                          </label>
                            <label className="flex flex-col gap-1 text-xs text-white/70">
                            Display order
                            <input
                              type="number"
                              value={component.displayOrder}
                              onChange={(event) => updateJourneyComponent(component.key, "displayOrder", event.target.value)}
                              placeholder={String(absoluteIndex)}
                              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs text-white/70">
                            Channel eligibility
                            <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
                              {selectedChannels.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {selectedChannels.map((channel) => (
                                    <span
                                      key={`${component.key}-${channel}`}
                                      className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] text-white/70"
                                    >
                                      {channel.toUpperCase()}
                                      <button
                                        type="button"
                                        onClick={() => removeJourneyChannel(component.key, channel)}
                                        className="rounded-full border border-white/30 px-1 text-[0.6rem] text-white/70 transition hover:border-white/60 hover:text-white"
                                        aria-label={`Remove ${channel} channel`}
                                      >
                                        &times;
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[0.65rem] text-white/50">All channels eligible</p>
                              )}
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input
                                  value={channelDraftValue}
                                  onChange={(event) => handleChannelInputChange(component.key, event.target.value)}
                                  onKeyDown={(event) => handleChannelInputKeyDown(component.key, event)}
                                  placeholder="Add channel and press Enter"
                                  list={channelDatalistId}
                                  className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => commitChannelDraft(component.key)}
                                  disabled={!canAddChannel}
                                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  Add channel
                                </button>
                              </div>
                              <datalist id={channelDatalistId}>
                                {CHANNEL_OPTIONS.map((option) => (
                                  <option key={`${component.key}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </datalist>
                              {CHANNEL_OPTIONS.length ? (
                                <div className="flex flex-wrap items-center gap-2 text-[0.6rem] uppercase tracking-[0.3em] text-white/50">
                                  <span>Suggestions:</span>
                                  {CHANNEL_OPTIONS.map((option) => {
                                    const normalizedValue = normalizeChannelToken(option.value);
                                    const isSelected = selectedChannels.includes(normalizedValue);
                                    return (
                                      <button
                                        type="button"
                                        key={`${component.key}-${option.value}-suggestion`}
                                        onClick={() => applyJourneyChannels(component.key, [normalizedValue])}
                                        disabled={isSelected}
                                        className="rounded-full border border-white/15 px-2 py-0.5 text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                            <span className="text-[0.65rem] text-white/40">
                              Leave blank to allow all channels.
                            </span>
                          </label>
                          <label className="flex flex-col gap-2 text-xs text-white/70">
                            Required step
                            <span className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/50 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={component.isRequired}
                                onChange={(event) =>
                                  updateJourneyComponent(component.key, "isRequired", event.target.checked)
                                }
                                className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                              />
                              <span className="text-white/70">Block progression until this component succeeds.</span>
                            </span>
                          </label>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/70">
                          {definition ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-white">{definition.name}</p>
                                  {definition.description ? (
                                    <p className="text-white/60">{definition.description}</p>
                                  ) : null}
                                </div>
                                <div className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                                  {definition.scriptSlug}
                                </div>
                              </div>
                              {definition.triggers?.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {definition.triggers.map((trigger, triggerIndex) => (
                                    <span
                                      key={`${definition.id}-trigger-${triggerIndex}`}
                                      className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white/60"
                                    >
                                      {trigger.stage} · {trigger.event}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-white/50">Select a component to preview script details and triggers.</p>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                            <span>Bindings</span>
                            <span>{component.bindings.length} configured</span>
                          </div>
                          {component.bindings.length === 0 ? (
                            <p className="text-xs text-white/50">No bindings yet. Add one to map component inputs.</p>
                          ) : (
                            component.bindings.map((binding) => (
                              <div
                                key={binding.key}
                                className="space-y-3 rounded-xl border border-white/10 bg-black/45 p-3"
                              >
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Input key
                                    <input
                                      value={binding.inputKey}
                                      onChange={(event) =>
                                        updateJourneyBinding(component.key, binding.key, {
                                          inputKey: event.target.value
                                        })
                                      }
                                      placeholder="handle"
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-white/70">
                                    Binding type
                                    <select
                                      value={binding.kind}
                                      onChange={(event) =>
                                        changeJourneyBindingKind(
                                          component.key,
                                          binding.key,
                                          event.target.value as JourneyComponentBindingDraft["kind"]
                                        )
                                      }
                                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                    >
                                      <option value="static">Static value</option>
                                      <option value="product_field">Product field</option>
                                      <option value="runtime">Runtime</option>
                                    </select>
                                  </label>
                                  {binding.kind === "static" ? (
                                    <label className="flex flex-col gap-1 text-xs text-white/70">
                                      Value
                                      <input
                                        value={binding.value}
                                        onChange={(event) =>
                                          updateJourneyBinding(component.key, binding.key, { value: event.target.value })
                                        }
                                        placeholder="demo_handle"
                                        className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                      />
                                    </label>
                                  ) : binding.kind === "product_field" ? (
                                    <label className="flex flex-col gap-1 text-xs text-white/70">
                                      Field path
                                      <input
                                        value={binding.path}
                                        onChange={(event) =>
                                          updateJourneyBinding(component.key, binding.key, { path: event.target.value })
                                        }
                                        placeholder="optionGroups[0].options[0].id"
                                        className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                      />
                                    </label>
                                  ) : (
                                    <label className="flex flex-col gap-1 text-xs text-white/70">
                                      Runtime source
                                      <input
                                        value={binding.source}
                                        onChange={(event) =>
                                          updateJourneyBinding(component.key, binding.key, { source: event.target.value })
                                        }
                                        placeholder="order.id"
                                        className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                                      />
                                    </label>
                                  )}
                                </div>
                                {binding.kind !== "static" ? (
                                  <label className="flex items-center gap-2 text-xs text-white/70">
                                    <input
                                      type="checkbox"
                                      checked={binding.required}
                                      onChange={(event) =>
                                        updateJourneyBinding(component.key, binding.key, {
                                          required: event.target.checked
                                        })
                                      }
                                      className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
                                    />
                                    Required input
                                  </label>
                                ) : null}
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => removeJourneyComponentBinding(component.key, binding.key)}
                                    className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                                  >
                                    Remove binding
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                          <button
                            type="button"
                            onClick={() => addJourneyComponentBinding(component.key)}
                            className="rounded-full border border-white/20 px-4 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                          >
                            Add binding
                          </button>
                        </div>
                        <label className="flex flex-col gap-2 text-xs text-white/70">
                          Metadata JSON
                          <textarea
                            value={component.metadataJson}
                            onChange={(event) => updateJourneyComponent(component.key, "metadataJson", event.target.value)}
                            placeholder='{"owner":"merchandising"}'
                            className="min-h-[96px] rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                          />
                          {metadataError ? (
                            <span className="text-[0.65rem] text-rose-300">{metadataError}</span>
                          ) : (
                            <span className="text-[0.65rem] text-white/40">
                              Optional JSON payload passed to the runtime when this component executes.
                            </span>
                          )}
                        </label>
                        <div className="space-y-1 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/70">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                              Preview execution
                            </span>
                            <button
                              type="button"
                              onClick={() => handleJourneyPreviewRun(component)}
                              disabled={!canRunPreview || previewState?.status === "running"}
                              className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {previewState?.status === "running" ? "Queuing…" : "Run component"}
                            </button>
                          </div>
                          <p className="text-[0.65rem] text-white/40">
                            {canRunPreview
                              ? "Queues this component with automation metadata so you can inspect the output."
                              : "Save this product first to enable admin previews."}
                          </p>
                          {previewState?.status === "success" ? (
                            <p className="text-[0.65rem] text-emerald-300">
                              Run queued (ID {previewState.lastRunId?.slice(0, 8) ?? "pending"}).
                            </p>
                          ) : previewState?.status === "error" ? (
                            <p className="text-[0.65rem] text-rose-300">{previewState.message ?? "Preview failed."}</p>
                          ) : null}
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveJourneyComponent(component.key)}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                          >
                            Remove component
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                  )}
                </>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddJourneyComponent}
                  disabled={!journeyCatalog.length || isLoadingJourneyCatalog}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add journey component
                </button>
                {isLoadingJourneyCatalog ? (
                  <span className="text-xs text-white/50">Loading component registry…</span>
                ) : journeyCatalog.length === 0 ? null : (
                  <span className="text-xs text-white/50">
                    {journeyCatalog.length} definition{journeyCatalog.length === 1 ? "" : "s"} available
                  </span>
                )}
              </div>
            </section>

            {journeyCatalog.length > 0 ? (
              <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-6">
                <header className="flex flex-col gap-1">
                  <h3 className="text-lg font-semibold text-white">Journey registry search</h3>
                  <p className="text-sm text-white/60">
                    Discover definitions, inspect triggers, and quickly attach components without scrolling through long dropdowns.
                  </p>
                </header>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Search registry
                    <input
                      type="search"
                      value={journeyRegistryQuery}
                      onChange={(event) => setJourneyRegistryQuery(event.target.value)}
                      placeholder="Search definitions, tags, or scripts"
                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Stage filter
                    <select
                      value={journeyRegistryStage}
                      onChange={(event) =>
                        setJourneyRegistryStage(event.target.value as JourneyComponentStage | "all")
                      }
                      className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    >
                      {JOURNEY_STAGE_FILTERS.map((option) => (
                        <option key={`journey-registry-stage-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                  <p>
                    Showing {journeyRegistryResults.length} of {filteredJourneyCatalog.length} match
                    {filteredJourneyCatalog.length === 1 ? "" : "es"} ({journeyCatalog.length} definition
                    {journeyCatalog.length === 1 ? "" : "s"} total)
                  </p>
                  {(journeyRegistryQuery.trim().length > 0 || journeyRegistryStage !== "all") && (
                    <button
                      type="button"
                      onClick={() => {
                        setJourneyRegistryQuery("");
                        setJourneyRegistryStage("all");
                      }}
                      className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/60 transition hover:border-white/40 hover:text-white"
                    >
                      Reset registry filters
                    </button>
                  )}
                </div>
                {journeyRegistryResults.length === 0 ? (
                  <p className="text-sm text-white/60">
                    No definitions match the registry filters. Update the query above to continue.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {journeyRegistryResults.map((definition) => (
                      <li
                        key={definition.id}
                        className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/80"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-base font-semibold text-white">{definition.name}</p>
                            {definition.description ? (
                              <p className="text-xs text-white/60">{definition.description}</p>
                            ) : null}
                            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                              {definition.scriptSlug}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAttachJourneyFromRegistry(definition.id)}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                          >
                            Attach to draft
                          </button>
                        </div>
                        {definition.triggers?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {definition.triggers.map((trigger, triggerIndex) => (
                              <span
                                key={`${definition.id}-registry-trigger-${triggerIndex}`}
                                className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white/60"
                              >
                                {trigger.stage} · {trigger.event}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {definition.tags?.length ? (
                          <div className="flex flex-wrap gap-1 text-[0.55rem] uppercase tracking-[0.3em] text-white/40">
                            {definition.tags.map((tag) => (
                              <span key={`${definition.id}-${tag}`} className="rounded-full border border-white/10 px-2 py-0.5">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {hasMoreJourneyRegistryResults ? (
                  <p className="text-xs text-white/50">
                    Refine registry filters to view the remaining{" "}
                    {filteredJourneyCatalog.length - journeyRegistryResults.length} definition
                    {filteredJourneyCatalog.length - journeyRegistryResults.length === 1 ? "" : "s"}.
                  </p>
                ) : null}
              </section>
            ) : null}

            <AssetGalleryManager
              assetDrafts={assetDrafts}
              onDraftsChange={setAssetDrafts}
              disabled={isCreating || isUploadingAssets}
            />

            {feedback ? (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  feedback.type === "error"
                    ? "border-red-500/40 bg-red-500/10 text-red-100"
                    : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {feedback.message}
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isCreating || isUploadingAssets}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreating || isUploadingAssets ? "Saving..." : "Save product"}
              </button>
            </div>
          </form>

          <CreationPreview
            draft={draft}
            optionGroups={previewOptionGroups}
            addOns={previewAddOns}
            customFields={previewCustomFields}
            subscriptionPlans={previewSubscriptionPlans}
            configurationPresets={previewConfigurationPresets}
            journeyComponents={journeyComponents}
            journeyComponentLookup={journeyComponentLookup}
            journeyComponentHealth={journeyComponentHealthMap}
            journeyRuntime={journeyRuntime}
            onRefreshJourneyRuntime={hasExistingProduct ? refreshJourneyRuntime : undefined}
            isRefreshingJourneyRuntime={isRefreshingJourneyRuntime}
            hasExistingProduct={hasExistingProduct}
            blueprintOptions={blueprintOptionPreviews}
            assetDrafts={assetDrafts}
            previewChannel={previewChannel}
            onPreviewChannelChange={setPreviewChannel}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Existing products</h2>
            <p className="text-sm text-white/60">Edit pricing and metadata, or remove deprecated SKUs.</p>
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">
            {normalizedProducts.length} item{normalizedProducts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-black/20 p-6">
          {normalizedProducts.length === 0 ? (
            <p className="text-sm text-white/60">
              No products published via the API yet. Create your first product using the form above.
            </p>
          ) : (
            <table className="w-full min-w-[820px] divide-y divide-white/10 text-left text-sm text-white/70">
              <thead className="text-xs uppercase tracking-[0.2em] text-white/40">
                <tr>
                  <th className="py-3 font-normal">Title</th>
                  <th className="py-3 font-normal">Slug</th>
                  <th className="py-3 font-normal">Category</th>
                  <th className="py-3 font-normal">Price</th>
                  <th className="py-3 font-normal">Status</th>
                  <th className="py-3 font-normal text-right" aria-label="Actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-sm text-white/80">
                {normalizedProducts.map((product) => {
                  const channels = product.channelEligibility ?? [];
                  return (
                    <tr key={product.id} className="align-top">
                      <td className="py-4">
                        <div className="font-medium text-white">{product.title}</div>
                        {product.description ? (
                          <p className="mt-1 text-xs text-white/50 line-clamp-2">{product.description}</p>
                        ) : null}
                        {channels.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {channels.map((channel) => (
                              <span
                                key={`${product.id}-${channel}`}
                                className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.25em] text-white/50"
                              >
                                {channel.toUpperCase()}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-4 text-white/60">{product.slug}</td>
                      <td className="py-4 text-white/60">{product.category}</td>
                      <td className="py-4 text-white/60">
                        {formatPrice(product.currency, product.base_price ?? product.basePrice)}
                      </td>
                      <td className="py-4 text-white/60">{resolveStatusLabel(product.status)}</td>
                      <td className="py-4">
                        <div className="mb-2 flex justify-end">
                          <Link
                            href={{ pathname: "/admin/products", query: { productSlug: product.slug } }}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-white/40 hover:text-white"
                          >
                            Load in composer
                          </Link>
                        </div>
                        <form onSubmit={handleUpdate} className="flex flex-wrap items-center justify-end gap-2">
                          <input type="hidden" name="productId" value={product.id} />
                          <label className="flex flex-col text-[0.7rem] text-white/60">
                            Title
                            <input
                              name="title"
                              defaultValue={product.title}
                              className="w-44 rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col text-[0.7rem] text-white/60">
                            Price
                            <input
                              name="basePrice"
                              type="number"
                              defaultValue={product.base_price ?? product.basePrice ?? ""}
                              className="w-24 rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col text-[0.7rem] text-white/60">
                            Status
                            <select
                              name="status"
                              defaultValue={(product.status ?? "draft").toLowerCase()}
                              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="submit"
                            className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/80"
                          >
                            Update
                          </button>
                        </form>
                        <form onSubmit={handleDelete} className="mt-2 flex justify-end" method="post">
                          <input type="hidden" name="productId" value={product.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-white/40"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

type CreationPreviewProps = {
  draft: ProductDraft;
  optionGroups: ConfiguratorOptionGroup[];
  addOns: ConfiguratorAddOn[];
  customFields: ConfiguratorCustomField[];
  subscriptionPlans: ConfiguratorSubscriptionPlan[];
  configurationPresets: ConfiguratorPreset[];
  journeyComponents: JourneyComponentDraft[];
  journeyComponentLookup: Map<string, JourneyComponentDefinition>;
  journeyComponentHealth: Map<string, JourneyComponentHealthSummary>;
  journeyRuntime: ProductJourneyRuntime | null;
  isRefreshingJourneyRuntime: boolean;
  onRefreshJourneyRuntime?: () => void;
  hasExistingProduct: boolean;
  blueprintOptions: OptionBlueprintPreview[];
  assetDrafts: AssetDraft[];
  previewChannel: string;
  onPreviewChannelChange: (channel: string) => void;
};

function CreationPreview({
  draft,
  optionGroups,
  addOns,
  customFields,
  subscriptionPlans,
  configurationPresets,
  journeyComponents,
  journeyComponentLookup,
  journeyComponentHealth,
  journeyRuntime,
  isRefreshingJourneyRuntime,
  onRefreshJourneyRuntime,
  hasExistingProduct,
  blueprintOptions,
  assetDrafts,
  previewChannel,
  onPreviewChannelChange,
}: CreationPreviewProps) {
  const optionLabelLookup = useMemo(() => {
    const map = new Map<string, { groupName: string; label: string }>();
    optionGroups.forEach((group) => {
      group.options.forEach((option) => {
        map.set(option.id, { groupName: group.name, label: option.label });
      });
    });
    return map;
  }, [optionGroups]);

  const addOnLabelLookup = useMemo(() => {
    const map = new Map<string, string>();
    addOns.forEach((addOn) => map.set(addOn.id, addOn.label));
    return map;
  }, [addOns]);

  const trimmedSlug = draft.slug.trim();
  const trimmedTitle = draft.title.trim();
  const trimmedDescription = draft.description.trim();
  const trimmedCategory = draft.category.trim();
  const parsedBasePrice = Number(draft.basePrice);
  const basePriceValue = Number.isFinite(parsedBasePrice) ? parsedBasePrice : undefined;

  const payloadPreview = useMemo(
    () => ({
      slug: trimmedSlug || null,
      title: trimmedTitle || null,
      category: trimmedCategory || null,
      basePrice: basePriceValue ?? null,
      currency: draft.currency.trim() || "EUR",
      status: draft.status,
      channelEligibility: draft.channelEligibility,
      configuration:
        optionGroups.length ||
        addOns.length ||
        customFields.length ||
        subscriptionPlans.length ||
        journeyComponents.length
          ? "attached"
          : null,
      assets: assetDrafts.length
    }),
    [
      trimmedSlug,
      trimmedTitle,
      trimmedCategory,
      basePriceValue,
      draft.currency,
      draft.status,
      draft.channelEligibility,
      optionGroups.length,
      addOns.length,
      customFields.length,
      subscriptionPlans.length,
      journeyComponents.length,
      assetDrafts.length
    ]
  );

  const orderedAssets = useMemo(
    () => assetDrafts.slice().sort((a, b) => a.displayOrder - b.displayOrder),
    [assetDrafts]
  );

  return (
    <aside className="flex h-full flex-col justify-between rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-white/80">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Storefront preview</p>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${STATUS_BADGE_CLASSES[draft.status]}`}
          >
            {resolveStatusLabel(draft.status)}
          </span>
        </div>
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4">
          <h3 className="text-lg font-semibold text-white">
            {trimmedTitle || "Waiting for product title"}
          </h3>
          <p className="text-xs text-white/50">
            {trimmedSlug ? `slug: ${trimmedSlug}` : "Slug will map to the public product URL."}
          </p>
          <p className="text-xs text-white/50">
            {trimmedCategory ? `category: ${trimmedCategory}` : "Set a category to organize catalog listings."}
          </p>
          <p className="text-sm text-white/70">
            {trimmedDescription || "Description preview will appear here as you type."}
          </p>
          <p className="text-base font-semibold text-white">
            {basePriceValue !== undefined
              ? formatPrice(draft.currency, basePriceValue)
              : "Add a base price to preview"}
          </p>
          {draft.channelEligibility.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {draft.channelEligibility.map((channel) => (
                <span
                  key={`preview-${channel}`}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.25em] text-white/60"
                >
                  {channel.toUpperCase()}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/50">No channels selected yet.</p>
          )}
        </div>
        {journeyComponents.length ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Journey components</p>
              <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                {journeyComponents.length} linked
              </span>
            </div>
            <ul className="space-y-2 text-xs text-white/70">
              {journeyComponents.map((component) => {
                const definition = journeyComponentLookup.get(component.componentId);
                const channelLabels = parseChannelEligibilityValue(component.channelEligibility);
                const triggerSummary = definition?.triggers
                  ?.map((trigger) => `${trigger.stage}:${trigger.event}`)
                  .join(", ");
                return (
                  <li key={component.key} className="rounded-lg border border-white/10 bg-black/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {definition ? definition.name : "Select component"}
                      </span>
                      {component.isRequired ? (
                        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-rose-200">Required</span>
                      ) : null}
                    </div>
                    {definition?.description ? (
                      <p className="text-[0.65rem] text-white/50">{definition.description}</p>
                    ) : null}
                    {triggerSummary ? (
                      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{triggerSummary}</p>
                    ) : null}
                    {channelLabels.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {channelLabels.map((channel) => (
                          <span
                            key={`${component.key}-${channel}`}
                            className="rounded-full border border-white/15 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] text-white/60"
                          >
                            {channel || "—"}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[0.6rem] text-white/40">All channels eligible</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <JourneyRuntimePanel
          hasExistingProduct={hasExistingProduct}
          journeyRuntime={journeyRuntime}
          journeyComponentLookup={journeyComponentLookup}
          journeyComponentHealth={journeyComponentHealth}
          isRefreshing={isRefreshingJourneyRuntime}
          onRefresh={onRefreshJourneyRuntime}
        />
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/40 p-3">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Preview channel</p>
              <p className="text-sm font-semibold text-white">{previewChannel.toUpperCase()}</p>
            </div>
            <select
              value={previewChannel}
              onChange={(event) => onPreviewChannelChange(event.target.value)}
              className="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white focus:border-white/60 focus:outline-none"
            >
              {(draft.channelEligibility.length > 0 ? draft.channelEligibility : CHANNEL_OPTIONS.map((option) => option.value)).map(
                (channel) => (
                  <option key={`preview-channel-${channel}`} value={channel}>
                    {channel.toUpperCase()}
                  </option>
                ),
              )}
            </select>
          </div>
          <ProductConfigurator
            basePrice={basePriceValue ?? 0}
            currency={draft.currency || "EUR"}
            optionGroups={optionGroups}
            addOns={addOns}
            customFields={customFields}
            subscriptionPlans={subscriptionPlans}
            activeChannel={previewChannel}
          />
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Gallery preview</p>
            {orderedAssets.length ? (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {orderedAssets.map((asset) => (
                  <div
                    key={asset.clientId}
                    className="min-w-[140px] rounded-2xl border border-white/15 bg-black/40 p-2 text-white/70"
                  >
                    <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-black/60">
                      {asset.previewUrl ? (
                        <Image
                          src={asset.previewUrl}
                          alt={asset.altText || asset.label || "Queued asset"}
                          fill
                          sizes="140px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[0.65rem] text-white/40">
                          Preview pending
                        </div>
                      )}
                    </div>
                    <p className="truncate text-xs font-semibold text-white">{asset.label}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asset.isPrimary ? (
                        <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] text-emerald-200">
                          Primary
                        </span>
                      ) : null}
                      {asset.usageTags.map((tag) => (
                        <span
                          key={`${asset.clientId}-${tag}`}
                          className="rounded-full border border-white/20 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] text-white/60"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-white/50">No assets queued yet.</p>
            )}
          </div>
          {addOns.length > 0 ? (
            <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-white/70">
              <div className="flex items-center justify-between">
                <p className="uppercase tracking-[0.3em] text-white/40">Margin telemetry</p>
                <span className="text-white/50">{addOns.length} add-on{addOns.length === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] divide-y divide-white/10 text-left">
                  <thead className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                    <tr>
                      <th className="py-2 font-normal">Add-on</th>
                      <th className="py-2 font-normal">Customer delta</th>
                      <th className="py-2 font-normal">Provider cost</th>
                      <th className="py-2 font-normal">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {addOns.map((addOn) => {
                      const info = getAddOnPricingInfo(addOn.metadata ?? addOn.metadataJson ?? null, addOn.pricing ?? null);
                      const delta = typeof addOn.computedDelta === "number" ? addOn.computedDelta : addOn.priceDelta;
                      const marginInsight = buildAddOnMarginInsight({
                        addOn,
                        info,
                        productCurrency: draft.currency || "EUR",
                        subtotalBeforeAddOns: basePriceValue ?? 0,
                        fxRates: FX_RATE_TABLE,
                      });
                      const providerCostDisplay = marginInsight
                        ? formatProviderCostSummary(marginInsight, draft.currency || "EUR") ?? "—"
                        : info.providerCostAmount != null
                          ? formatPrice(info.providerCostCurrency ?? draft.currency ?? "EUR", info.providerCostAmount)
                          : "—";
                      const marginDisplay = marginInsight
                        ? formatMarginLabel(marginInsight, draft.currency || "EUR")
                        : "Pending input";

                      return (
                        <tr key={`preview-margin-${addOn.id ?? addOn.label}`}>
                          <td className="py-2 pr-4">
                            <div className="font-semibold text-white">{addOn.label}</div>
                            <div className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                              {info.serviceProviderName ?? info.serviceId ?? "—"}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-white/80">
                            {typeof delta === "number" ? formatPrice(draft.currency || "EUR", delta) : "—"}
                          </td>
                          <td className="py-2 pr-4 text-white/60">{providerCostDisplay}</td>
                          <td className="py-2 text-white">{marginDisplay}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {subscriptionPlans.length > 0 ? (
            <div className="mt-4 space-y-2 text-xs text-white/60">
              <p className="uppercase tracking-[0.3em] text-white/40">Plan calculator</p>
              <ul className="space-y-1">
                {subscriptionPlans.map((plan) => {
                  const multiplier = plan.priceMultiplier ?? 1;
                  const delta = plan.priceDelta ?? 0;
                  const computed =
                    (basePriceValue ?? 0) * (Number.isFinite(multiplier) ? multiplier : 1) +
                    (Number.isFinite(delta) ? delta : 0);
                  return (
                    <li key={plan.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-white/80">
                          {plan.label} · {plan.billingCycle.replace("_", " ")}
                        </span>
                        {plan.description ? (
                          <span className="text-white/50">{plan.description}</span>
                        ) : null}
                      </div>
                      <span className="text-white font-medium">
                        {formatPrice(draft.currency || "EUR", computed)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {blueprintOptions.length > 0 ? (
            <div className="mt-4 space-y-3 text-xs text-white/60">
              <p className="uppercase tracking-[0.3em] text-white/40">Blueprint metadata</p>
              <div className="grid gap-3">
                {blueprintOptions.map((option) => {
                  const heroPreview =
                    option.heroSource === "external" && option.heroImageUrl ? option.heroImageUrl : null;
                  const heroBadge =
                    option.heroSource === "media"
                      ? option.heroLabel ?? option.heroImageUrl ?? "Media asset"
                      : option.heroSource === "external"
                        ? "External hero"
                        : "Hero pending";
                  const amountSummary =
                    option.amount && option.amountUnit
                      ? [
                          `${option.amount.toLocaleString()} ${option.amountUnit}`,
                          option.unitPrice != null
                            ? `${new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency: draft.currency || "EUR",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              }).format(option.unitPrice)} per ${option.amountUnit.slice(0, 3)}`
                            : null,
                          option.basePrice != null
                            ? `Package ${formatPrice(draft.currency || "EUR", option.basePrice)}`
                            : null
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : null;
                  const sampleAmountLabel =
                    option.calculatorSampleAmount != null
                      ? option.calculatorSampleAmount.toLocaleString()
                      : "–";
                  const sampleDaysLabel =
                    option.calculatorSampleDays != null ? option.calculatorSampleDays.toLocaleString() : "–";
                  return (
                    <div
                      key={`${option.groupName}-${option.optionLabel}`}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
                    >
                      {heroPreview ? (
                        <div className="relative h-36 w-full overflow-hidden border-b border-white/10">
                          <Image
                            src={heroPreview}
                            alt={`${option.optionLabel} hero`}
                            fill
                            unoptimized
                            sizes="(min-width: 1024px) 320px, 100vw"
                            className="object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
                          <div className="absolute bottom-2 left-2 rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] text-white/70">
                            {heroBadge}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-36 w-full items-center justify-center border-b border-white/10 bg-black/30 text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                          {heroBadge}
                        </div>
                      )}
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{option.optionLabel}</p>
                            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                              {option.groupName}
                            </p>
                          </div>
                          {option.fulfillmentSla ? (
                            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/60">
                              {option.fulfillmentSla}
                            </span>
                          ) : null}
                        </div>
                        {option.marketingTagline ? (
                          <p className="text-sm text-white/80">{option.marketingTagline}</p>
                        ) : null}
                        {amountSummary ? <p className="text-xs text-white/60">{amountSummary}</p> : null}
                        {option.dripMinPerDay != null ? (
                          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                            Drip ≥ {option.dripMinPerDay}/day
                          </p>
                        ) : null}
                        {option.discountTiers && option.discountTiers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {option.discountTiers.map((tier) => {
                              const tierPrice = new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency: draft.currency || "EUR",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              }).format(tier.unitPrice);
                              return (
                                <span
                                  key={`${tier.minAmount}-${tier.unitPrice}-${tier.label ?? "tier"}`}
                                  className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[0.65rem] text-white/60"
                                >
                                  {tier.label ? `${tier.label} · ` : ""}
                                  {tier.minAmount.toLocaleString()}+ @ {tierPrice}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {option.calculatorExpression ? (
                          <div
                            className={`space-y-1 rounded-xl border px-3 py-2 ${
                              option.calculatorExpressionValid
                                ? "border-white/15 bg-white/5 text-white/60"
                                : "border-red-400/40 bg-red-500/5 text-red-200"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[0.65rem] uppercase tracking-[0.3em]">
                                Calculator
                              </span>
                              {option.calculatorExpressionValid && option.calculatorSampleResult != null ? (
                                <span className="text-sm font-semibold text-white">
                                  {option.calculatorSampleResult.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                            <code className="block text-sm text-white/80">{option.calculatorExpression}</code>
                            {option.calculatorExpressionValid ? (
                              <p className="text-[0.65rem] text-white/50">
                                Samples amount {sampleAmountLabel} · days {sampleDaysLabel}
                              </p>
                            ) : (
                              <p className="text-[0.65rem] text-red-200">
                                Expression must use numbers, amount, and days only.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {configurationPresets.length > 0 ? (
            <div className="mt-4 space-y-3 text-xs text-white/60">
              <p className="uppercase tracking-[0.3em] text-white/40">Configuration presets</p>
              <div className="grid gap-3">
                {configurationPresets.map((preset) => {
                  const optionCount = Object.values(preset.selection.optionSelections).reduce(
                    (total, values) => total + values.length,
                    0
                  );
                  const addOnCount = preset.selection.addOnIds.length;
                  const customFieldCount = Object.keys(preset.selection.customFieldValues ?? {}).length;
                  const planLabel = preset.selection.subscriptionPlanId
                    ? subscriptionPlans.find((plan) => plan.id === preset.selection.subscriptionPlanId)?.label ?? null
                    : null;

                  return (
                    <div key={preset.id ?? preset.label} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      {preset.heroImageUrl ? (
                        <div className="relative mb-3 h-32 overflow-hidden rounded-xl border border-white/10">
                          <Image
                            src={preset.heroImageUrl}
                            alt={preset.label}
                            fill
                            sizes="(max-width: 768px) 100vw, 40vw"
                            className="object-cover"
                          />
                          {preset.badge ? (
                            <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/70 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-white">
                              {preset.badge}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white">{preset.label}</p>
                        {preset.summary ? <p className="text-xs text-white/60">{preset.summary}</p> : null}
                        {preset.priceHint ? <p className="text-xs text-white/50">{preset.priceHint}</p> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                        <span>{optionCount} options</span>
                        {addOnCount > 0 ? <span>{addOnCount} add-ons</span> : null}
                        {planLabel ? <span>{planLabel}</span> : null}
                        {customFieldCount > 0 ? <span>{customFieldCount} field{customFieldCount === 1 ? "" : "s"}</span> : null}
                      </div>
                      {Object.entries(preset.selection.optionSelections).length > 0 ? (
                        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3 text-white/70">
                          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Selections</p>
                          <ul className="space-y-1 text-xs">
                            {Object.entries(preset.selection.optionSelections).map(([groupId, optionIds]) => {
                              if (optionIds.length === 0) {
                                return null;
                              }
                              const groupLabel =
                                optionGroups.find((group) => group.id === groupId)?.name ??
                                optionLabelLookup.get(optionIds[0] ?? "")?.groupName ??
                                groupId;
                              const optionLabels = optionIds
                                .map((optionId) => optionLabelLookup.get(optionId)?.label ?? optionId)
                                .join(", ");
                              return (
                                <li key={groupId} className="text-white/70">
                                  <span className="font-semibold text-white">{groupLabel}:</span>{" "}
                                  <span>{optionLabels}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {addOnCount > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1 text-[0.6rem] uppercase tracking-[0.3em] text-white/50">
                          {preset.selection.addOnIds.map((addOnId) => {
                            return (
                              <span
                                key={addOnId}
                                className="rounded-full border border-white/15 px-2 py-0.5 text-white/60"
                              >
                                {addOnLabelLookup.get(addOnId) ?? addOnId}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <div className="border-b border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/40">
          Payload snapshot
        </div>
        <pre className="max-h-56 overflow-auto px-4 py-3 text-xs text-white/60">
          {JSON.stringify(payloadPreview, null, 2)}
        </pre>
      </div>
    </aside>
  );
}

type JourneyRuntimePanelProps = {
  hasExistingProduct: boolean;
  journeyRuntime: ProductJourneyRuntime | null;
  journeyComponentLookup: Map<string, JourneyComponentDefinition>;
  journeyComponentHealth: Map<string, JourneyComponentHealthSummary>;
  isRefreshing: boolean;
  onRefresh?: () => void;
};

function JourneyRuntimePanel({
  hasExistingProduct,
  journeyRuntime,
  journeyComponentLookup,
  journeyComponentHealth,
  isRefreshing,
  onRefresh,
}: JourneyRuntimePanelProps) {
  if (!hasExistingProduct) {
    return null;
  }
  if (!journeyRuntime) {
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-white/60">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Journey runtime</p>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => onRefresh?.()}
              className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
            >
              Retry
            </button>
          ) : null}
        </div>
        <p>Unable to load run history. Try refreshing or reload this page.</p>
      </div>
    );
  }

  const runs = journeyRuntime.recentRuns ?? [];
  const productLabel = journeyRuntime.slug || journeyRuntime.title || journeyRuntime.productId;
  const successCount = runs.filter((run) => run.status === "succeeded").length;
  const failureCount = runs.filter((run) => run.status === "failed").length;
  const successRate = runs.length ? Math.round((successCount / runs.length) * 100) : 0;
  const lastRun = runs[0];
  const lastFailure = runs.find((run) => run.status === "failed");
  const componentHealthEntries = Array.from(journeyComponentHealth.entries());
  const sortedComponentHealth = componentHealthEntries
    .slice()
    .sort(([, a], [, b]) => {
      const aWeight = getJourneyComponentHealthSortWeight(resolveJourneyComponentHealthState(a));
      const bWeight = getJourneyComponentHealthSortWeight(resolveJourneyComponentHealthState(b));
      if (aWeight !== bWeight) {
        return aWeight - bWeight;
      }
      if (a.failureCount !== b.failureCount) {
        return b.failureCount - a.failureCount;
      }
      return b.runCount - a.runCount;
    });

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Journey runtime</p>
          <p className="text-xs text-white/60">
            {runs.length ? `Latest ${Math.min(runs.length, 5)} runs for ${productLabel}` : "No runs recorded yet"}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={() => onRefresh?.()}
            disabled={isRefreshing}
            className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-progress disabled:opacity-40"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        ) : null}
      </div>
      {componentHealthEntries.length ? (
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Component health</p>
            <p className="text-[0.6rem] text-white/50">
              {componentHealthEntries.length} component{componentHealthEntries.length === 1 ? "" : "s"}
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {sortedComponentHealth.map(([entryKey, entry]) => {
              const definition = journeyComponentLookup.get(entry.componentId);
              const stageSummary =
                definition?.triggers && definition.triggers.length > 0
                  ? Array.from(new Set(definition.triggers.map((trigger) => trigger.stage))).join(", ")
                  : null;
              const state = resolveJourneyComponentHealthState(entry);
              const badge = getJourneyComponentHealthBadgeStyles(state);
              const description = describeJourneyComponentHealth(entry);
              const lastRunTimestamp = formatRuntimeTimestamp(
                entry.lastRun?.completedAt ??
                  entry.lastRun?.startedAt ??
                  entry.lastRun?.queuedAt ??
                  null,
              );
              return (
                <li
                  key={entryKey}
                  className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {definition?.name ?? entry.componentId}
                      </p>
                      {description ? (
                        <p className="text-[0.6rem] text-white/40">{description}</p>
                      ) : null}
                      {stageSummary ? (
                        <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/30">
                          {stageSummary}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] ${badge.border} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-[0.6rem] uppercase tracking-[0.2em] text-white/40 sm:grid-cols-4">
                    <div>
                      <dt>Runs</dt>
                      <dd className="text-white/90">{entry.runCount}</dd>
                    </div>
                    <div>
                      <dt>Success</dt>
                      <dd className="text-emerald-200">{entry.successCount}</dd>
                    </div>
                    <div>
                      <dt>Failure</dt>
                      <dd className="text-rose-200">{entry.failureCount}</dd>
                    </div>
                    <div>
                      <dt>Last run</dt>
                      <dd className="text-white/90">{lastRunTimestamp ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {runs.length === 0 ? (
        <p className="text-xs text-white/60">
          Trigger a component via checkout, automation, or the run API to start streaming telemetry.
        </p>
      ) : (
        <ul className="space-y-3">
          <li className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Success rate</p>
                <p className="text-base font-semibold text-white">
                  {successRate.toFixed(0)}%{" "}
                  <span className="text-[0.6rem] text-white/50">({successCount}/{runs.length})</span>
                </p>
              </div>
              <div>
                <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Last run</p>
                <p className="text-sm text-white/80">
                  {lastRun ? `${lastRun.status.toUpperCase()} • ${formatRuntimeTimestamp(lastRun.completedAt) ?? "pending"}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Recent failures</p>
                <p className={`text-sm ${failureCount ? "text-rose-200" : "text-white/80"}`}>
                  {failureCount ? `${failureCount} run${failureCount === 1 ? "" : "s"} failed` : "No failures"}
                </p>
                {lastFailure?.errorMessage ? (
                  <p className="mt-1 text-[0.6rem] text-white/50 line-clamp-2">{lastFailure.errorMessage}</p>
                ) : null}
              </div>
            </div>
          </li>
          {runs.slice(0, 5).map((run) => {
            const telemetry = (run.telemetry ?? {}) as Record<string, unknown>;
            const statusStyle = RUNTIME_STATUS_STYLES[run.status] ?? RUNTIME_STATUS_STYLES.pending;
            const runnerLabel =
              typeof telemetry.runner === "string" && telemetry.runner.length > 0 ? telemetry.runner : "—";
            const latencyLabel =
              typeof telemetry.latencyMs === "number" && telemetry.latencyMs >= 0
                ? `${telemetry.latencyMs} ms`
                : "—";
            const bindingCount =
              typeof telemetry.bindingsCount === "number"
                ? telemetry.bindingsCount
                : Array.isArray(run.bindingSnapshot)
                ? run.bindingSnapshot.length
                : 0;
            const timestamp =
              formatRuntimeTimestamp(run.completedAt) ??
              formatRuntimeTimestamp(run.startedAt) ??
              formatRuntimeTimestamp(run.queuedAt) ??
              formatRuntimeTimestamp(run.createdAt);
            const triggerSummary =
              run.trigger && typeof run.trigger === "object"
                ? `${run.trigger.stage}:${run.trigger.event}`
                : null;
            const previewSnippet =
              typeof telemetry.outputPreview === "string" && telemetry.outputPreview.length > 0
                ? telemetry.outputPreview
                : typeof telemetry.errorPreview === "string" && telemetry.errorPreview.length > 0
                ? telemetry.errorPreview
                : run.errorMessage && run.errorMessage.length > 0
                ? run.errorMessage
                : null;
            const componentDefinition = journeyComponentLookup.get(run.componentId);
            const componentLabel = componentDefinition?.name ?? run.componentId;
            return (
              <li key={run.id} className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">{componentLabel}</p>
                    <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                      {triggerSummary ?? "Runtime trigger"}
                    </p>
                    <p className="text-xs text-white/50">
                      {run.channel ? run.channel.toUpperCase() : "ANY CHANNEL"}
                      {timestamp ? ` • ${timestamp}` : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] ${statusStyle.border} ${statusStyle.text}`}
                  >
                    {statusStyle.label}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-[0.65rem] text-white/70 sm:grid-cols-4">
                  <div>
                    <dt className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Runner</dt>
                    <dd className="text-white/90">{runnerLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Latency</dt>
                    <dd className="text-white/90">{latencyLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Bindings</dt>
                    <dd className="text-white/90">{bindingCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Attempts</dt>
                    <dd className="text-white/90">{run.attempts}</dd>
                  </div>
                </dl>
                {previewSnippet ? (
                  <p className="rounded-lg border border-white/10 bg-black/50 p-2 text-[0.7rem] text-white/70">
                    {truncatePreview(previewSnippet)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatRuntimeTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return RUNTIME_TIMESTAMP_FORMATTER.format(parsed);
}

function truncatePreview(value: string, maxLength = 200): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function buildJourneyComponentHealthMap(
  journeyRuntime: ProductJourneyRuntime | null,
): Map<string, JourneyComponentHealthSummary> {
  const map = new Map<string, JourneyComponentHealthSummary>();
  if (!journeyRuntime) {
    return map;
  }
  const apiSummaries = journeyRuntime.componentHealth ?? [];
  if (apiSummaries.length > 0) {
    apiSummaries.forEach((summary) => {
      const key = summary.productComponentId ?? summary.componentId;
      map.set(key, summary);
    });
    return map;
  }
  (journeyRuntime.journeyComponents ?? []).forEach((component) => {
    const key = component.id ?? component.componentId;
    map.set(key, {
      componentId: component.componentId,
      productComponentId: component.id,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      lastRun: undefined,
    });
  });
  (journeyRuntime.recentRuns ?? []).forEach((run) => {
    const key = run.productComponentId ?? run.componentId;
    const summary =
      map.get(key) ??
      (() => {
        const fallback: JourneyComponentHealthSummary = {
          componentId: run.componentId,
          productComponentId: run.productComponentId,
          runCount: 0,
          successCount: 0,
          failureCount: 0,
          lastRun: undefined,
        };
        map.set(key, fallback);
        return fallback;
      })();
    summary.runCount += 1;
    if (run.status === "succeeded") {
      summary.successCount += 1;
    } else if (run.status === "failed") {
      summary.failureCount += 1;
    }
    if (!summary.lastRun) {
      summary.lastRun = run;
    }
  });
  return map;
}

function resolveJourneyComponentHealthState(
  summary: JourneyComponentHealthSummary | null,
): JourneyComponentHealthState {
  if (!summary || summary.runCount === 0) {
    return "pending";
  }
  if (summary.failureCount >= summary.runCount / 2) {
    return "failing";
  }
  if (summary.failureCount > 0) {
    return "warning";
  }
  return "healthy";
}

function getJourneyComponentHealthBadgeStyles(state: JourneyComponentHealthState) {
  switch (state) {
    case "healthy":
      return { border: "border-emerald-400/40", text: "text-emerald-300", label: "Healthy" };
    case "warning":
      return { border: "border-amber-400/40", text: "text-amber-300", label: "Attention" };
    case "failing":
      return { border: "border-rose-400/50", text: "text-rose-200", label: "Failing" };
    default:
      return { border: "border-white/20", text: "text-white/60", label: "Pending data" };
  }
}

function describeJourneyComponentHealth(summary: JourneyComponentHealthSummary | null): string {
  if (!summary || summary.runCount === 0) {
    return "No runs recorded yet";
  }
  if (summary.failureCount === 0) {
    return summary.successCount === 1 ? "1 successful run" : `${summary.successCount} successful runs`;
  }
  return `${summary.successCount} success · ${summary.failureCount} failure${
    summary.failureCount === 1 ? "" : "s"
  }`;
}

function getJourneyComponentHealthSortWeight(state: JourneyComponentHealthState): number {
  switch (state) {
    case "failing":
      return 0;
    case "warning":
      return 1;
    case "pending":
      return 2;
    case "healthy":
      return 3;
    default:
      return 4;
  }
}

type ServiceRulesEditorProps = {
  addOnKey: string;
  rules: ServiceRuleDraft[];
  providers: FulfillmentProvider[];
  onAddRule: (addOnKey: string) => void;
  onUpdateRule: ServiceRuleUpdater;
  onRemoveRule: (addOnKey: string, ruleKey: string) => void;
};

function getAddOnMarginStatusStyle(status: MarginStatus) {
  switch (status) {
    case "pass":
      return { border: "border-emerald-400/40", text: "text-emerald-300", label: "Healthy" };
    case "warn":
      return { border: "border-amber-400/40", text: "text-amber-300", label: "Warning" };
    case "fail":
      return { border: "border-rose-400/40", text: "text-rose-300", label: "Below guardrails" };
    default:
      return { border: "border-white/15", text: "text-white/60", label: "Pending input" };
  }
}

function buildServicePresetPatch(
  service: FulfillmentService,
  pricing: AddOnPricingDraft,
  currencyFallback: string,
  options?: { force?: boolean },
): Partial<AddOnPricingDraft> {
  const { force = false } = options ?? {};
  const metadata = service.metadata;
  const patch: Partial<AddOnPricingDraft> = {};

  const recommendedCurrency =
    metadata.costModel?.currency ??
    metadata.guardrails?.currency ??
    service.defaultCurrency ??
    currencyFallback;
  if (recommendedCurrency && (force || !pricing.costCurrency)) {
    patch.costCurrency = recommendedCurrency;
  }

  const defaultQuantity =
    typeof metadata.defaultInputs?.quantity === "number" ? metadata.defaultInputs.quantity : undefined;
  if (defaultQuantity != null && (force || !pricing.previewQuantity)) {
    patch.previewQuantity = String(defaultQuantity);
  }

  const quantityForCost =
    safePositiveNumber(pricing.previewQuantity) ??
    defaultQuantity ??
    (typeof metadata.defaultInputs?.quantity === "number" ? metadata.defaultInputs.quantity : undefined) ??
    1;
  const costEstimate = estimateProviderCost(metadata.costModel, quantityForCost);
  if (costEstimate != null && (force || !pricing.costAmount)) {
    const normalized = Number.isFinite(costEstimate) ? costEstimate : Number(pricing.costAmount) || 0;
    patch.costAmount = normalized.toFixed(2).replace(/\.00$/, "");
  }

  if (metadata.defaultInputs?.ratePerDay != null && (force || !pricing.dripPerDay)) {
    patch.dripPerDay = String(metadata.defaultInputs.ratePerDay);
  }

  if (metadata.guardrails?.minimumMarginPercent != null && (force || !pricing.marginTarget)) {
    patch.marginTarget = String(metadata.guardrails.minimumMarginPercent);
  }

  const orderTemplate = metadata.payloadTemplates?.find((template) => template.operation === "order");
  if (orderTemplate?.bodyTemplate && (force || !pricing.payloadTemplate)) {
    patch.payloadTemplate = JSON.stringify(orderTemplate.bodyTemplate, null, 2);
  }

  return patch;
}

function ServiceRulesEditor({ addOnKey, rules, providers, onAddRule, onUpdateRule, onRemoveRule }: ServiceRulesEditorProps) {
  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        id: provider.id,
        label: `${provider.name} (${provider.id})`,
      })),
    [providers],
  );
  const serviceOptions = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.services.map((service) => ({
          id: service.id,
          label: `${service.name} (${service.action})`,
          providerId: provider.id,
          providerName: provider.name,
        })),
      ),
    [providers],
  );
  const serviceLookup = useMemo(() => new Map(serviceOptions.map((entry) => [entry.id, entry])), [serviceOptions]);
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-white/20 bg-black/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Rule builder</p>
          <p className="text-sm text-white/60">Swap provider settings based on geo, channel, or drip constraints.</p>
        </div>
        <button
          type="button"
          onClick={() => onAddRule(addOnKey)}
          className="rounded-full border border-white/30 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/60 hover:text-white"
        >
          Add rule
        </button>
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-white/50">No rules configured. Default override applies everywhere.</p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div key={rule.key} className="space-y-3 rounded-lg border border-white/10 bg-black/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">Rule {index + 1}</p>
                <button
                  type="button"
                  onClick={() => onRemoveRule(addOnKey, rule.key)}
                  className="rounded-full border border-white/20 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Label
                  <input
                    value={rule.label}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "label", event.target.value)}
                    placeholder="EU slow drip"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Description
                  <input
                    value={rule.description}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "description", event.target.value)}
                    placeholder="Fallback to slow cadence for EU orders"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Priority
                  <input
                    type="number"
                    value={rule.priority}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "priority", event.target.value)}
                    placeholder="1"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Channels (comma separated)
                  <input
                    value={rule.channels}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "channels", event.target.value)}
                    placeholder="storefront,loyalty"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Regions (comma separated)
                  <input
                    value={rule.regions}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "regions", event.target.value)}
                    placeholder="eu,us"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Min/max amount (units)
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={rule.minAmount}
                      onChange={(event) => onUpdateRule(addOnKey, rule.key, "minAmount", event.target.value)}
                      placeholder="min"
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={rule.maxAmount}
                      onChange={(event) => onUpdateRule(addOnKey, rule.key, "maxAmount", event.target.value)}
                      placeholder="max"
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Min/max drip per day
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={rule.minDrip}
                      onChange={(event) => onUpdateRule(addOnKey, rule.key, "minDrip", event.target.value)}
                      placeholder="min"
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={rule.maxDrip}
                      onChange={(event) => onUpdateRule(addOnKey, rule.key, "maxDrip", event.target.value)}
                      placeholder="max"
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    />
                  </div>
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Override service ID
                  <input
                    value={rule.overrideServiceId}
                    onChange={(event) => {
                      const value = event.target.value;
                      onUpdateRule(addOnKey, rule.key, "overrideServiceId", value);
                      const descriptor = serviceLookup.get(value.trim());
                      if (descriptor?.providerId) {
                        onUpdateRule(addOnKey, rule.key, "overrideProviderId", descriptor.providerId);
                      }
                    }}
                    placeholder="svc_followers_eu"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    list={`service-options-${addOnKey}-${rule.key}`}
                  />
                  <datalist id={`service-options-${addOnKey}-${rule.key}`}>
                    {serviceOptions.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.label} · {service.providerName}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Provider ID
                  <input
                    value={rule.overrideProviderId}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "overrideProviderId", event.target.value)}
                    placeholder="xyz_network"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                    list={`provider-options-${addOnKey}-${rule.key}`}
                  />
                  <datalist id={`provider-options-${addOnKey}-${rule.key}`}>
                    {providerOptions.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Cost amount
                  <input
                    type="number"
                    value={rule.costAmount}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "costAmount", event.target.value)}
                    placeholder="110"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Cost currency
                  <input
                    value={rule.costCurrency}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "costCurrency", event.target.value)}
                    placeholder="EUR"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 uppercase text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Margin target (%)
                  <input
                    type="number"
                    value={rule.marginTarget}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "marginTarget", event.target.value)}
                    placeholder="20"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Fulfillment mode
                  <select
                    value={rule.fulfillmentMode}
                    onChange={(event) =>
                      onUpdateRule(
                        addOnKey,
                        rule.key,
                        "fulfillmentMode",
                        event.target.value as ServiceRuleDraft["fulfillmentMode"],
                      )
                    }
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="refill">Refill</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Drip per day override
                  <input
                    type="number"
                    value={rule.dripPerDay}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "dripPerDay", event.target.value)}
                    placeholder="50"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Preview quantity
                  <input
                    type="number"
                    value={rule.previewQuantity}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "previewQuantity", event.target.value)}
                    placeholder="100"
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70">
                  Payload template (JSON)
                  <textarea
                    value={rule.payloadTemplate}
                    onChange={(event) => onUpdateRule(addOnKey, rule.key, "payloadTemplate", event.target.value)}
                    placeholder='{"geo":"EU","providerOrderId":"{{providerOrderId}}"}'
                    rows={3}
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-[0.7rem] text-white focus:border-white/40 focus:outline-none"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
