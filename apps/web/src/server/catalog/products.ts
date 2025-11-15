import "server-only";

// meta: module: catalog-products

import type {
  ProductAddOn,
  ProductAddOnMetadata,
  ProductAddOnPricingSnapshot,
  ProductConfigurationPreset,
  ProductCustomField,
  ProductCustomFieldMetadata,
  ProductFulfillmentSummary,
  ProductOptionGroup,
  ProductOptionMetadata,
  ProductMediaAsset,
  ProductSubscriptionPlan,
} from "@/types/product";
import {
  normalizeAddOnMetadata as sharedNormalizeAddOnMetadata,
  normalizeCustomFieldMetadata as sharedNormalizeCustomFieldMetadata,
  normalizeOptionMetadata as sharedNormalizeOptionMetadata,
  serializeAddOnMetadata as sharedSerializeAddOnMetadata,
  serializeCustomFieldMetadata as sharedSerializeCustomFieldMetadata,
  serializeOptionMetadata as sharedSerializeOptionMetadata,
} from "@/lib/product-metadata";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

export type ProductSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  basePrice: number;
  currency: string;
  status: "draft" | "active" | "archived";
  channelEligibility: string[];
  updatedAt: string;
};

export type ProductDetail = ProductSummary & {
  description: string | null;
  optionGroups: ProductOptionGroup[];
  addOns: ProductAddOn[];
  customFields: ProductCustomField[];
  subscriptionPlans: ProductSubscriptionPlan[];
  fulfillmentSummary: ProductFulfillmentSummary | null;
  mediaAssets: ProductMediaAsset[];
  auditLog: { id: string; action: string; createdAt: string }[];
  configurationPresets: ProductConfigurationPreset[];
};

export type ProductConfigurationInput = {
  optionGroups: Array<{
    id: string | null;
    name: string;
    description: string | null;
    groupType: "single" | "multiple";
    isRequired: boolean;
    displayOrder: number;
    metadata: Record<string, unknown>;
    options: Array<{
      id: string | null;
      name: string;
      description: string | null;
      priceDelta: number;
      displayOrder: number;
      metadata: ProductOptionMetadata | null;
    }>;
  }>;
  addOns: Array<{
    id: string | null;
    label: string;
    description: string | null;
    priceDelta: number;
    isRecommended: boolean;
    displayOrder: number;
    metadata: ProductAddOnMetadata | null;
  }>;
  customFields: Array<{
    id: string | null;
    label: string;
    fieldType: "text" | "url" | "number";
    placeholder: string | null;
    helpText: string | null;
    isRequired: boolean;
    displayOrder: number;
    metadata: ProductCustomFieldMetadata | null;
  }>;
  subscriptionPlans: Array<{
    id: string | null;
    label: string;
    description: string | null;
    billingCycle: "one_time" | "monthly" | "quarterly" | "annual";
    priceMultiplier: number | null;
    priceDelta: number | null;
    isDefault: boolean;
    displayOrder: number;
  }>;
  configurationPresets: Array<{
    id: string | null;
    label: string;
    summary: string | null;
    heroImageUrl: string | null;
    badge: string | null;
    priceHint: string | null;
    displayOrder: number;
    selection: {
      optionSelections: Record<string, string[]>;
      addOnIds: string[];
      subscriptionPlanId: string | null;
      customFieldValues: Record<string, string>;
    };
  }>;
};

type ApiRecord = Record<string, unknown>;

const fallbackConfiguration: Pick<
  ProductDetail,
  "optionGroups" | "addOns" | "customFields" | "subscriptionPlans" | "fulfillmentSummary" | "configurationPresets"
> = {
  optionGroups: [
    {
      id: "fallback-platform",
      name: "Platform",
      description: "Choose the social platform focus for the launch.",
      groupType: "single",
      isRequired: true,
      displayOrder: 0,
      options: [
        {
          id: "fallback-platform-ig",
          label: "Instagram",
          description: "Stories + feed asset mix",
          priceDelta: 0,
          metadataJson: {
            recommended: true,
            structuredPricing: {
              amount: 1,
              amountUnit: "package",
              basePrice: 199,
              unitPrice: 199,
            },
          },
          displayOrder: 0,
        },
        {
          id: "fallback-platform-tiktok",
          label: "TikTok",
          description: "Short-form narrative",
          priceDelta: 35,
          metadataJson: {
            structuredPricing: {
              amount: 1,
              amountUnit: "package",
              basePrice: 234,
              unitPrice: 234,
            },
          },
          displayOrder: 1,
        },
      ],
    },
  ],
  addOns: [
    {
      id: "fallback-boost",
      label: "Paid boost credit",
      description: "Managed boost with reporting",
      priceDelta: 120,
      isRecommended: false,
      displayOrder: 0,
      metadataJson: {
        pricing: {
          mode: "flat",
          amount: 120,
        },
      },
      pricing: {
        mode: "flat",
        amount: 120,
      },
      computedDelta: 120,
      percentageMultiplier: null,
    },
  ],
  customFields: [
    {
      id: "fallback-brand-url",
      label: "Brand URL",
      fieldType: "url",
      placeholder: "https://yoursite.com",
      helpText: "Used in creative references.",
      isRequired: true,
      displayOrder: 0,
      metadataJson: {
        passthrough: {
          checkout: true,
          fulfillment: true,
        },
      },
      validationRules: null,
      defaultValue: null,
      conditionalVisibility: undefined,
      passthroughTargets: {
        checkout: true,
        fulfillment: true,
      },
    },
  ],
  subscriptionPlans: [
    {
      id: "fallback-one-shot",
      label: "One-time",
      description: "Project-based engagement",
      billingCycle: "one_time",
      priceMultiplier: null,
      priceDelta: null,
      isDefault: true,
      displayOrder: 0,
    },
    {
      id: "fallback-quarterly",
      label: "Quarterly retainer",
      description: "Refresh creative quarterly",
      billingCycle: "quarterly",
      priceMultiplier: 0.9,
      priceDelta: null,
      isDefault: false,
      displayOrder: 1,
    },
  ],
  fulfillmentSummary: null,
  configurationPresets: [],
};

const PRODUCT_DETAIL_CACHE_TTL_MS = 30_000;
const productDetailCache = new Map<
  string,
  {
    expiresAt: number;
    value: ProductDetail | null;
  }
>();

const fallbackProducts: ProductSummary[] = [
  {
    id: "demo-product",
    slug: "demo-product",
    title: "Demo social launch kit",
    category: "starter",
    basePrice: 199,
    currency: "EUR",
    status: "active",
    channelEligibility: ["storefront", "loyalty"],
    updatedAt: new Date().toISOString(),
  },
];

function normalizeAddOnPricingSnapshot(source: unknown): ProductAddOnPricingSnapshot | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const snapshot = source as Record<string, unknown>;
  const modeRaw = snapshot.mode;
  if (typeof modeRaw !== "string") {
    return null;
  }

  const mode = modeRaw as ProductAddOnPricingSnapshot["mode"];
  if (!["flat", "percentage", "serviceOverride"].includes(mode)) {
    return null;
  }

  const result: ProductAddOnPricingSnapshot = { mode };

  const amount = snapshot.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) {
    result.amount = amount;
  }

  const multiplier = snapshot.percentageMultiplier;
  if (typeof multiplier === "number" && Number.isFinite(multiplier)) {
    result.percentageMultiplier = multiplier;
  }

  const serviceId = snapshot.serviceId;
  if (typeof serviceId === "string" && serviceId.trim().length > 0) {
    result.serviceId = serviceId;
  }

  const serviceAction = snapshot.serviceAction;
  if (typeof serviceAction === "string" && serviceAction.trim().length > 0) {
    result.serviceAction = serviceAction;
  }

  const providerId = snapshot.serviceProviderId;
  if (typeof providerId === "string" && providerId.trim().length > 0) {
    result.serviceProviderId = providerId;
  }

  const providerName = snapshot.serviceProviderName;
  if (typeof providerName === "string" && providerName.trim().length > 0) {
    result.serviceProviderName = providerName;
  }

  if (snapshot.serviceDescriptor && typeof snapshot.serviceDescriptor === "object") {
    result.serviceDescriptor = snapshot.serviceDescriptor as Record<string, unknown>;
  }

  const providerCostAmount = snapshot.providerCostAmount;
  if (typeof providerCostAmount === "number" && Number.isFinite(providerCostAmount)) {
    result.providerCostAmount = providerCostAmount;
  }

  const providerCostCurrency = snapshot.providerCostCurrency;
  if (typeof providerCostCurrency === "string" && providerCostCurrency.trim().length > 0) {
    result.providerCostCurrency = providerCostCurrency;
  }

  const marginTarget = snapshot.marginTarget;
  if (typeof marginTarget === "number" && Number.isFinite(marginTarget)) {
    result.marginTarget = marginTarget;
  }

  const fulfillmentMode = snapshot.fulfillmentMode;
  if (
    typeof fulfillmentMode === "string" &&
    ["immediate", "scheduled", "refill"].includes(fulfillmentMode)
  ) {
    result.fulfillmentMode = fulfillmentMode as ProductAddOnPricingSnapshot["fulfillmentMode"];
  }

  if (snapshot.payloadTemplate && typeof snapshot.payloadTemplate === "object") {
    result.payloadTemplate = snapshot.payloadTemplate as Record<string, unknown>;
  }

  const dripPerDay = snapshot.dripPerDay;
  if (typeof dripPerDay === "number" && Number.isFinite(dripPerDay)) {
    result.dripPerDay = dripPerDay;
  }

  const previewQuantity = snapshot.previewQuantity;
  if (typeof previewQuantity === "number" && Number.isFinite(previewQuantity)) {
    result.previewQuantity = previewQuantity;
  }

  if (Array.isArray(snapshot.serviceRules)) {
    result.serviceRules = snapshot.serviceRules;
  } else if (snapshot.serviceRules === null) {
    result.serviceRules = null;
  }

  return result;
}

function mapOptionGroups(payload: unknown): ProductOptionGroup[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw, index) => {
    const item = raw as ApiRecord;
    const optionsPayload = Array.isArray(item.options) ? (item.options as ApiRecord[]) : [];
    const options = optionsPayload.map((optionRaw, optionIndex) => {
      const option = optionRaw as ApiRecord;
      const baseMetadata = sharedNormalizeOptionMetadata(
        option.metadataJson ?? option.metadata ?? {}
      );
      const metadata: ProductOptionMetadata = { ...baseMetadata };

      const legacyTagline = option.marketingTagline ?? option.marketing_tagline;
      if (!metadata.marketingTagline && typeof legacyTagline === "string" && legacyTagline.trim().length > 0) {
        metadata.marketingTagline = legacyTagline.trim();
      }

      const legacySla = option.fulfillmentSla ?? option.fulfillment_sla;
      if (!metadata.fulfillmentSla && typeof legacySla === "string" && legacySla.trim().length > 0) {
        metadata.fulfillmentSla = legacySla.trim();
      }

      const legacyHero = option.heroImageUrl ?? option.hero_image_url;
      if (!metadata.heroImageUrl && typeof legacyHero === "string" && legacyHero.trim().length > 0) {
        metadata.heroImageUrl = legacyHero.trim();
      }

      const calculatorSource =
        option.calculator && typeof option.calculator === "object" ? (option.calculator as Record<string, unknown>) : null;
      const calculatorExpression =
        (calculatorSource?.expression as string | undefined) ??
        (typeof option.calculatorExpression === "string" ? option.calculatorExpression : undefined);
      if (calculatorExpression && calculatorExpression.trim().length > 0) {
        const calculator: ProductOptionMetadata["calculator"] = {
          expression: calculatorExpression.trim(),
        };
        const sampleAmount =
          calculatorSource?.sampleAmount ?? calculatorSource?.sample_amount ?? option.calculatorSampleAmount;
        const sampleDays =
          calculatorSource?.sampleDays ?? calculatorSource?.sample_days ?? option.calculatorSampleDays;
        if (sampleAmount != null && Number.isFinite(Number(sampleAmount))) {
          calculator.sampleAmount = Number(sampleAmount);
        }
        if (sampleDays != null && Number.isFinite(Number(sampleDays))) {
          calculator.sampleDays = Number(sampleDays);
        }
        metadata.calculator = calculator;
      }

      return {
        id: String(option.id ?? `option-${optionIndex}`),
        label: String(option.label ?? option.name ?? "Option"),
        description: option.description ? String(option.description) : null,
        priceDelta: Number(option.priceDelta ?? 0),
        metadataJson: Object.keys(metadata).length > 0 ? metadata : {},
        displayOrder: Number.isFinite(option.displayOrder)
          ? Number(option.displayOrder)
          : optionIndex,
      } satisfies ProductOptionGroup["options"][number];
    });

    const metadata =
      item.metadataJson && typeof item.metadataJson === "object"
        ? (item.metadataJson as Record<string, unknown>)
        : item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};

    return {
      id: String(item.id ?? `group-${index}`),
      name: String(item.name ?? "Option group"),
      description: item.description ? String(item.description) : null,
      groupType: String(item.groupType ?? "single") === "multiple" ? "multiple" : "single",
      isRequired: Boolean(item.isRequired),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
      options,
      metadataJson: metadata,
    };
  });
}

function mapAddOns(payload: unknown): ProductAddOn[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw, index) => {
    const item = raw as ApiRecord;
    const metadata =
      item.metadataJson && typeof item.metadataJson === "object"
        ? sharedNormalizeAddOnMetadata(item.metadataJson)
        : item.metadata && typeof item.metadata === "object"
          ? sharedNormalizeAddOnMetadata(item.metadata)
          : {};
    const pricingSnapshot = normalizeAddOnPricingSnapshot(item.pricing);
    let computedDelta = Number(item.priceDelta ?? 0);
    if (typeof item.computedDelta === "number" && Number.isFinite(item.computedDelta)) {
      computedDelta = item.computedDelta;
    }
    const percentageMultiplier =
      typeof item.percentageMultiplier === "number" && Number.isFinite(item.percentageMultiplier)
        ? Number(item.percentageMultiplier)
        : pricingSnapshot?.percentageMultiplier ?? null;
    return {
      id: String(item.id ?? `addon-${index}`),
      label: String(item.label ?? "Add-on"),
      description: item.description ? String(item.description) : null,
      priceDelta: Number(item.priceDelta ?? 0),
      isRecommended: Boolean(item.isRecommended),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
      metadataJson: metadata,
      pricing: pricingSnapshot,
      computedDelta,
      percentageMultiplier,
    } satisfies ProductAddOn;
  });
}

function mapCustomFields(payload: unknown): ProductCustomField[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw, index) => {
    const item = raw as ApiRecord;
    const fieldType = String(item.fieldType ?? "text");
    const allowed: Array<ProductCustomField["fieldType"]> = ["text", "url", "number"];
    const normalized = (allowed.includes(fieldType as ProductCustomField["fieldType"]) ? fieldType : "text") as ProductCustomField["fieldType"];
    const metadataSource =
      item.metadataJson && typeof item.metadataJson === "object"
        ? (item.metadataJson as Record<string, unknown>)
        : item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : undefined;
    const metadata =
      metadataSource && Object.keys(metadataSource).length > 0
        ? sharedNormalizeCustomFieldMetadata(metadataSource)
        : {};
    return {
      id: String(item.id ?? `field-${index}`),
      label: String(item.label ?? "Field"),
      fieldType: normalized,
      placeholder: item.placeholder ? String(item.placeholder) : null,
      helpText: item.helpText ? String(item.helpText) : null,
      isRequired: Boolean(item.isRequired),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
      metadataJson: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
      validationRules: metadata.validation ?? null,
      defaultValue: metadata.defaultValue ?? null,
      conditionalVisibility: metadata.conditionalVisibility,
      passthroughTargets: metadata.passthrough ?? undefined,
    } satisfies ProductCustomField;
  });
}

function mapConfigurationPresets(payload: unknown): ProductConfigurationPreset[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const presets = payload
    .map((raw, index) => {
      if (!raw || typeof raw !== "object") {
        return null;
      }
      const item = raw as ApiRecord;
      const selectionSource =
        item.selection && typeof item.selection === "object" ? (item.selection as Record<string, unknown>) : {};

      const optionSelectionsSource = selectionSource.optionSelections;
      const optionSelections: Record<string, string[]> = {};
      if (optionSelectionsSource && typeof optionSelectionsSource === "object") {
        Object.entries(optionSelectionsSource as Record<string, unknown>).forEach(([groupId, value]) => {
          if (typeof groupId !== "string" || !Array.isArray(value)) {
            return;
          }
          const normalized = (value as unknown[])
            .map((entry) => (typeof entry === "string" && entry.length > 0 ? entry : null))
            .filter((entry): entry is string => Boolean(entry));
          if (normalized.length > 0) {
            optionSelections[groupId] = normalized;
          }
        });
      }

      const addOnIdsSource = selectionSource.addOnIds;
      const addOnIds =
        Array.isArray(addOnIdsSource) && addOnIdsSource.length > 0
          ? (addOnIdsSource as unknown[])
              .map((entry) => (typeof entry === "string" && entry.length > 0 ? entry : null))
              .filter((entry): entry is string => Boolean(entry))
          : [];

      const customFieldValuesSource = selectionSource.customFieldValues;
      const customFieldValues: Record<string, string> = {};
      if (customFieldValuesSource && typeof customFieldValuesSource === "object") {
        Object.entries(customFieldValuesSource as Record<string, unknown>).forEach(([fieldId, value]) => {
          if (typeof fieldId === "string" && typeof value === "string") {
            customFieldValues[fieldId] = value;
          }
        });
      }

      const subscriptionPlanId =
        typeof selectionSource.subscriptionPlanId === "string"
          ? selectionSource.subscriptionPlanId
          : selectionSource.subscriptionPlanId === null
            ? null
            : undefined;

      return {
        id: typeof item.id === "string" ? item.id : `preset-${index}`,
        label: typeof item.label === "string" ? item.label : `Preset ${index + 1}`,
        summary: typeof item.summary === "string" ? item.summary : null,
        heroImageUrl: typeof item.heroImageUrl === "string" ? item.heroImageUrl : null,
        badge: typeof item.badge === "string" ? item.badge : null,
        priceHint: typeof item.priceHint === "string" ? item.priceHint : null,
        displayOrder:
          typeof item.displayOrder === "number" && Number.isFinite(item.displayOrder)
            ? Number(item.displayOrder)
            : index,
        selection: {
          optionSelections,
          addOnIds,
          subscriptionPlanId:
            typeof subscriptionPlanId === "string" || subscriptionPlanId === null ? subscriptionPlanId : null,
          customFieldValues,
        },
      } satisfies ProductConfigurationPreset;
    })
    .filter((preset): preset is ProductConfigurationPreset => preset != null);

  return presets.sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
  );
}

function mapSubscriptionPlans(payload: unknown): ProductSubscriptionPlan[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw, index) => {
    const item = raw as ApiRecord;
    const billingCycleRaw = String(item.billingCycle ?? "one_time");
    const allowed: Array<ProductSubscriptionPlan["billingCycle"]> = [
      "one_time",
      "monthly",
      "quarterly",
      "annual",
    ];
    const normalized: ProductSubscriptionPlan["billingCycle"] = allowed.includes(
      billingCycleRaw as ProductSubscriptionPlan["billingCycle"],
    )
      ? (billingCycleRaw as ProductSubscriptionPlan["billingCycle"])
      : "one_time";
    return {
      id: String(item.id ?? `plan-${index}`),
      label: String(item.label ?? "Plan"),
      description: item.description ? String(item.description) : null,
      billingCycle: normalized,
      priceMultiplier: item.priceMultiplier != null ? Number(item.priceMultiplier) : null,
      priceDelta: item.priceDelta != null ? Number(item.priceDelta) : null,
      isDefault: Boolean(item.isDefault),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
    } satisfies ProductSubscriptionPlan;
  });
}

function mapFulfillmentSummary(payload: unknown): ProductFulfillmentSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const summary = payload as ApiRecord;
  const deliveryRaw = summary.delivery as ApiRecord | undefined;
  const delivery = deliveryRaw
    ? {
        minDays: deliveryRaw.minDays != null ? Number(deliveryRaw.minDays) : null,
        maxDays: deliveryRaw.maxDays != null ? Number(deliveryRaw.maxDays) : null,
        averageDays: deliveryRaw.averageDays != null ? Number(deliveryRaw.averageDays) : null,
        confidence: deliveryRaw.confidence ? String(deliveryRaw.confidence) : null,
        headline: deliveryRaw.headline ? String(deliveryRaw.headline) : null,
        narrative: deliveryRaw.narrative ? String(deliveryRaw.narrative) : null,
      }
    : undefined;

  const assurances = Array.isArray(summary.assurances)
    ? (summary.assurances as ApiRecord[]).map((item, index) => ({
        id: String(item.id ?? `assurance-${index}`),
        label: String(item.label ?? "Assurance"),
        description: item.description ? String(item.description) : null,
        evidence: item.evidence ? String(item.evidence) : null,
        source: item.source ? String(item.source) : null,
      }))
    : [];

  const support = Array.isArray(summary.support)
    ? (summary.support as ApiRecord[]).map((item, index) => ({
        id: String(item.id ?? `support-${index}`),
        channel: String(item.channel ?? "email"),
        label: String(item.label ?? "Support"),
        target: String(item.target ?? "support@example.com"),
        availability: item.availability ? String(item.availability) : null,
      }))
    : [];

  return {
    delivery,
    assurances,
    support,
  };
}

function mapProductSummary(item: ApiRecord): ProductSummary {
  return {
    id: String(item.id),
    slug: String(item.slug),
    title: String(item.title),
    category: String(item.category),
    basePrice: Number(item.basePrice ?? item.base_price ?? 0),
    currency: String(item.currency ?? "EUR"),
    status: (item.status as ProductSummary["status"]) ?? "draft",
    channelEligibility: Array.isArray(item.channelEligibility)
      ? (item.channelEligibility as string[])
      : Array.isArray(item.channel_eligibility)
        ? (item.channel_eligibility as string[])
        : [],
    updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
  };
}

function mapProductDetail(payload: ApiRecord): ProductDetail {
  return {
    ...mapProductSummary(payload),
    description: (payload.description as string | null) ?? null,
    optionGroups: mapOptionGroups(payload.optionGroups),
    addOns: mapAddOns(payload.addOns),
    customFields: mapCustomFields(payload.customFields),
    subscriptionPlans: mapSubscriptionPlans(payload.subscriptionPlans),
    fulfillmentSummary: mapFulfillmentSummary(payload.fulfillmentSummary),
    mediaAssets: Array.isArray(payload.mediaAssets)
      ? (payload.mediaAssets as ApiRecord[])
          .reduce<ProductMediaAsset[]>((acc, asset) => {
          const assetUrlRaw = asset.assetUrl ?? asset.asset_url ?? asset.url ?? asset.href;
          if (typeof assetUrlRaw !== "string" || assetUrlRaw.length === 0) {
            return acc;
          }
          const usageTagsSource = Array.isArray(asset.usageTags ?? asset.usage_tags)
            ? (asset.usageTags ?? asset.usage_tags)
            : null;
          const usageTags = Array.isArray(usageTagsSource)
            ? (usageTagsSource as unknown[])
                .map((tag) =>
                  typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null,
                )
                .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
            : null;
          const metadataRecord =
            typeof asset.metadata === "object" && asset.metadata !== null
              ? (asset.metadata as Record<string, unknown>)
              : null;
          const normalized: ProductMediaAsset = {
            id: String(asset.id ?? asset.assetId ?? asset.asset_id ?? assetUrlRaw),
            clientId:
              typeof asset.clientId === "string" && asset.clientId.length > 0
                ? asset.clientId
                : null,
            assetUrl: String(assetUrlRaw),
            label: asset.label ? String(asset.label) : null,
            storageKey:
              typeof asset.storageKey === "string" && asset.storageKey.length > 0
                ? asset.storageKey
                : null,
            usageTags: usageTags && usageTags.length > 0 ? usageTags : null,
            altText:
              typeof asset.altText === "string" && asset.altText.length > 0
                ? asset.altText
                : null,
            displayOrder:
              typeof asset.displayOrder === "number" ? asset.displayOrder : null,
            isPrimary:
              typeof asset.isPrimary === "boolean"
                ? asset.isPrimary
                : typeof asset.primary === "boolean"
                  ? asset.primary
                  : null,
            checksum:
              typeof asset.checksum === "string" && asset.checksum.length > 0
                ? asset.checksum
                : null,
            metadata: metadataRecord,
            createdAt:
              typeof asset.createdAt === "string"
                ? asset.createdAt
                : typeof asset.created_at === "string"
                  ? asset.created_at
                  : null,
            updatedAt:
              typeof asset.updatedAt === "string"
                ? asset.updatedAt
                : typeof asset.updated_at === "string"
                  ? asset.updated_at
                  : null,
          };
          acc.push(normalized);
          return acc;
        }, [])
          .sort(
            (a, b) =>
              (typeof a.displayOrder === "number" ? a.displayOrder : 0) -
            (typeof b.displayOrder === "number" ? b.displayOrder : 0),
          )
      : [],
    configurationPresets: mapConfigurationPresets(payload.configurationPresets),
    auditLog: Array.isArray(payload.auditLog)
      ? (payload.auditLog as ApiRecord[]).map((entry) => ({
          id: String(entry.id),
          action: String(entry.action ?? "updated"),
          createdAt: String(entry.createdAt ?? entry.created_at ?? new Date().toISOString()),
        }))
      : [],
  };
}

function inflateConfiguration(
  base: ProductSummary,
  configuration: ProductConfigurationInput,
  description: string | null = null,
): ProductDetail {
  const optionGroups: ProductOptionGroup[] = configuration.optionGroups.map((group, index) => ({
    id: group.id ?? `draft-group-${index}`,
    name: group.name,
    description: group.description,
    groupType: group.groupType,
    isRequired: group.isRequired,
    displayOrder: Number.isFinite(group.displayOrder) ? group.displayOrder : index,
    metadataJson: group.metadata,
    options: group.options.map((option, optionIndex) => ({
      id: option.id ?? `draft-option-${index}-${optionIndex}`,
      label: option.name,
      description: option.description,
      priceDelta: Number(option.priceDelta ?? 0),
      metadataJson:
        option.metadata && Object.keys(option.metadata).length > 0
          ? sharedNormalizeOptionMetadata(option.metadata)
          : undefined,
      displayOrder: Number.isFinite(option.displayOrder) ? option.displayOrder : optionIndex,
    })),
  }));

  const addOns: ProductAddOn[] = configuration.addOns.map((addOn, index) => ({
    id: addOn.id ?? `draft-addon-${index}`,
    label: addOn.label,
    description: addOn.description,
    priceDelta: Number(addOn.priceDelta ?? 0),
    isRecommended: addOn.isRecommended,
    displayOrder: Number.isFinite(addOn.displayOrder) ? addOn.displayOrder : index,
    metadataJson:
      addOn.metadata && Object.keys(addOn.metadata).length > 0
        ? sharedNormalizeAddOnMetadata(addOn.metadata)
        : undefined,
    pricing: null,
    computedDelta: Number(addOn.priceDelta ?? 0),
    percentageMultiplier: null,
  }));

  const customFields: ProductCustomField[] = configuration.customFields.map((field, index) => {
    const normalizedFieldMetadata =
      field.metadata && Object.keys(field.metadata).length > 0
        ? sharedNormalizeCustomFieldMetadata(field.metadata)
        : undefined;
    return {
      id: field.id ?? `draft-field-${index}`,
      label: field.label,
      fieldType: field.fieldType,
      placeholder: field.placeholder,
      helpText: field.helpText,
      isRequired: field.isRequired,
      displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
      metadataJson: normalizedFieldMetadata ?? undefined,
      validationRules: normalizedFieldMetadata?.validation ?? null,
      defaultValue: normalizedFieldMetadata?.defaultValue ?? null,
      conditionalVisibility: normalizedFieldMetadata?.conditionalVisibility,
      passthroughTargets: normalizedFieldMetadata?.passthrough ?? undefined,
    };
  });

  const subscriptionPlans: ProductSubscriptionPlan[] = configuration.subscriptionPlans.map(
    (plan, index) => ({
      id: plan.id ?? `draft-plan-${index}`,
      label: plan.label,
      description: plan.description,
      billingCycle: plan.billingCycle,
      priceMultiplier:
        plan.priceMultiplier != null && Number.isFinite(plan.priceMultiplier)
          ? Number(plan.priceMultiplier)
          : null,
      priceDelta:
        plan.priceDelta != null && Number.isFinite(plan.priceDelta)
          ? Number(plan.priceDelta)
          : null,
      isDefault: plan.isDefault,
      displayOrder: Number.isFinite(plan.displayOrder) ? plan.displayOrder : index,
    }),
  );

  return {
    ...base,
    description,
    optionGroups,
    addOns,
    customFields,
    subscriptionPlans,
    fulfillmentSummary: null,
    mediaAssets: [],
    auditLog: [],
    configurationPresets: (configuration.configurationPresets ?? []).map((preset, index) => ({
      id: preset.id ?? `draft-preset-${index}`,
      label: preset.label,
      summary: preset.summary ?? null,
      heroImageUrl: preset.heroImageUrl ?? null,
      badge: preset.badge ?? null,
      priceHint: preset.priceHint ?? null,
      displayOrder: Number.isFinite(preset.displayOrder) ? preset.displayOrder : index,
      selection: {
        optionSelections: preset.selection.optionSelections,
        addOnIds: preset.selection.addOnIds,
        subscriptionPlanId: preset.selection.subscriptionPlanId ?? null,
        customFieldValues: preset.selection.customFieldValues,
      },
    })),
  };
}

export async function fetchProductSummaries(): Promise<ProductSummary[]> {
  if (!apiKeyHeader) {
    return fallbackProducts;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products`, {
    cache: "no-store",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to load products: ${response.statusText}`);
  }

  const payload = (await response.json()) as ApiRecord[];
  return payload.map((item) => mapProductSummary(item));
}

export async function fetchProductDetail(slug: string): Promise<ProductDetail | null> {
  const cached = productDetailCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value ? structuredClone(cached.value) : null;
  }

  if (!apiKeyHeader) {
    const fallback = fallbackProducts[0];
    const value = {
      ...fallback,
      description: "Fallback product for offline mode",
      optionGroups: fallbackConfiguration.optionGroups,
      addOns: fallbackConfiguration.addOns,
      customFields: fallbackConfiguration.customFields,
      subscriptionPlans: fallbackConfiguration.subscriptionPlans,
      fulfillmentSummary: fallbackConfiguration.fulfillmentSummary,
      mediaAssets: [],
      auditLog: [],
      configurationPresets: fallbackConfiguration.configurationPresets,
    };
    productDetailCache.set(slug, { expiresAt: Date.now() + PRODUCT_DETAIL_CACHE_TTL_MS, value });
    return structuredClone(value);
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${slug}`, {
    cache: "no-store",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load product: ${response.statusText}`);
  }

  const payload = (await response.json()) as ApiRecord;
  const detail = mapProductDetail(payload);
  productDetailCache.set(slug, { expiresAt: Date.now() + PRODUCT_DETAIL_CACHE_TTL_MS, value: detail });
  return detail;
}

export async function updateProductChannels(
  productId: string,
  channelEligibility: string[],
): Promise<ProductSummary> {
  if (!apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return { ...fallback, channelEligibility };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {}),
    },
    body: JSON.stringify({ channelEligibility }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update product channels: ${response.statusText}`);
  }

  const payload = (await response.json()) as ApiRecord;
  return mapProductSummary(payload);
}

export async function updateProductStatus(
  productId: string,
  status: ProductSummary["status"],
): Promise<ProductSummary> {
  if (!apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return { ...fallback, status };
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {}),
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update product status: ${response.statusText}`);
  }

  const payload = (await response.json()) as ApiRecord;
  return mapProductSummary(payload);
}

export async function replaceProductConfiguration(
  productId: string,
  configuration: ProductConfigurationInput,
): Promise<ProductDetail> {
  if (!apiKeyHeader) {
    const base = fallbackProducts.find((product) => product.id === productId) ?? fallbackProducts[0];
    return inflateConfiguration(base, configuration, "Fallback product for offline mode");
  }

  const body = {
    optionGroups: configuration.optionGroups.map((group, index) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      groupType: group.groupType,
      isRequired: group.isRequired,
      displayOrder: Number.isFinite(group.displayOrder) ? group.displayOrder : index,
      metadata: group.metadata ?? {},
      options: group.options.map((option, optionIndex) => ({
        id: option.id,
        name: option.name,
        description: option.description,
        priceDelta: Number(option.priceDelta ?? 0),
        displayOrder: Number.isFinite(option.displayOrder) ? option.displayOrder : optionIndex,
        metadata: sharedSerializeOptionMetadata(option.metadata),
      })),
    })),
    addOns: configuration.addOns.map((addOn, index) => ({
      id: addOn.id,
      label: addOn.label,
      description: addOn.description,
      priceDelta: Number(addOn.priceDelta ?? 0),
      isRecommended: addOn.isRecommended,
      displayOrder: Number.isFinite(addOn.displayOrder) ? addOn.displayOrder : index,
      metadata: sharedSerializeAddOnMetadata(addOn.metadata),
    })),
    customFields: configuration.customFields.map((field, index) => ({
      id: field.id,
      label: field.label,
      fieldType: field.fieldType,
      placeholder: field.placeholder,
      helpText: field.helpText,
      isRequired: field.isRequired,
      displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
      metadata: sharedSerializeCustomFieldMetadata(field.metadata),
    })),
    subscriptionPlans: configuration.subscriptionPlans.map((plan, index) => ({
      id: plan.id,
      label: plan.label,
      description: plan.description,
      billingCycle: plan.billingCycle,
      priceMultiplier:
        plan.priceMultiplier != null && Number.isFinite(plan.priceMultiplier)
          ? Number(plan.priceMultiplier)
          : null,
      priceDelta:
        plan.priceDelta != null && Number.isFinite(plan.priceDelta)
          ? Number(plan.priceDelta)
          : null,
      isDefault: plan.isDefault,
      displayOrder: Number.isFinite(plan.displayOrder) ? plan.displayOrder : index,
    })),
    configurationPresets: configuration.configurationPresets.map((preset, index) => ({
      id: preset.id,
      label: preset.label,
      summary: preset.summary,
      heroImageUrl: preset.heroImageUrl,
      badge: preset.badge,
      priceHint: preset.priceHint,
      displayOrder: Number.isFinite(preset.displayOrder) ? preset.displayOrder : index,
      selection: {
        optionSelections: preset.selection.optionSelections,
        addOnIds: preset.selection.addOnIds,
        subscriptionPlanId:
          typeof preset.selection.subscriptionPlanId === "string"
            ? preset.selection.subscriptionPlanId
            : preset.selection.subscriptionPlanId === null
              ? null
              : null,
        customFieldValues: preset.selection.customFieldValues,
      },
    })),
  };

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/options`, {
    method: "PUT",
    headers: defaultHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to update product configuration: ${response.statusText}`);
  }

  const payload = (await response.json()) as ApiRecord;
  return mapProductDetail(payload);
}

export type AttachProductAssetInput = {
  assetUrl: string;
  label?: string;
  clientId?: string | null;
  displayOrder?: number | null;
  isPrimary?: boolean | null;
  usageTags?: string[];
  altText?: string | null;
  checksum?: string | null;
  storageKey?: string | null;
  metadata?: Record<string, unknown>;
};

export async function attachProductAsset(productId: string, payload: AttachProductAssetInput): Promise<void> {
  if (!apiKeyHeader) {
    return;
  }

  const { metadata, ...rest } = payload;
  const body: Record<string, unknown> = { ...rest };
  if (metadata && Object.keys(metadata).length > 0) {
    body.metadata = metadata;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/assets`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to attach product asset: ${response.statusText}`);
  }
}

export async function deleteProductAsset(assetId: string): Promise<void> {
  if (!apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/assets/${assetId}`, {
    method: "DELETE",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete product asset: ${response.statusText}`);
  }
}

export async function restoreProductFromAudit(logId: string): Promise<void> {
  if (!apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/audit/${logId}/restore`, {
    method: "POST",
    headers: apiKeyHeader ? { "X-API-Key": apiKeyHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to restore product from audit: ${response.statusText}`);
  }
}
