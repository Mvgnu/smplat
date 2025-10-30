import "server-only";

// meta: module: catalog-products

import type {
  ProductAddOn,
  ProductCustomField,
  ProductFulfillmentSummary,
  ProductOptionGroup,
  ProductSubscriptionPlan,
} from "@/types/product";

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
  mediaAssets: { id: string; assetUrl: string; label: string | null }[];
  auditLog: { id: string; action: string; createdAt: string }[];
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
      metadata: Record<string, unknown>;
    }>;
  }>;
  addOns: Array<{
    id: string | null;
    label: string;
    description: string | null;
    priceDelta: number;
    isRecommended: boolean;
    displayOrder: number;
  }>;
  customFields: Array<{
    id: string | null;
    label: string;
    fieldType: "text" | "url" | "number";
    placeholder: string | null;
    helpText: string | null;
    isRequired: boolean;
    displayOrder: number;
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
};

type ApiRecord = Record<string, unknown>;

const fallbackConfiguration: Pick<
  ProductDetail,
  "optionGroups" | "addOns" | "customFields" | "subscriptionPlans" | "fulfillmentSummary"
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
          metadataJson: { recommended: true },
          displayOrder: 0,
        },
        {
          id: "fallback-platform-tiktok",
          label: "TikTok",
          description: "Short-form narrative",
          priceDelta: 35,
          metadataJson: {},
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
};

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

function mapOptionGroups(payload: unknown): ProductOptionGroup[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw, index) => {
    const item = raw as ApiRecord;
    const optionsPayload = Array.isArray(item.options) ? (item.options as ApiRecord[]) : [];
    const options = optionsPayload.map((optionRaw, optionIndex) => {
      const option = optionRaw as ApiRecord;
      const metadata =
        option.metadataJson && typeof option.metadataJson === "object"
          ? (option.metadataJson as Record<string, unknown>)
          : option.metadata && typeof option.metadata === "object"
            ? (option.metadata as Record<string, unknown>)
            : {};
      return {
        id: String(option.id ?? `option-${optionIndex}`),
        label: String(option.label ?? option.name ?? "Option"),
        description: option.description ? String(option.description) : null,
        priceDelta: Number(option.priceDelta ?? 0),
        metadataJson: metadata,
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
    return {
      id: String(item.id ?? `addon-${index}`),
      label: String(item.label ?? "Add-on"),
      description: item.description ? String(item.description) : null,
      priceDelta: Number(item.priceDelta ?? 0),
      isRecommended: Boolean(item.isRecommended),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
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
    return {
      id: String(item.id ?? `field-${index}`),
      label: String(item.label ?? "Field"),
      fieldType: normalized,
      placeholder: item.placeholder ? String(item.placeholder) : null,
      helpText: item.helpText ? String(item.helpText) : null,
      isRequired: Boolean(item.isRequired),
      displayOrder: Number.isFinite(item.displayOrder) ? Number(item.displayOrder) : index,
    } satisfies ProductCustomField;
  });
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
      ? (payload.mediaAssets as ApiRecord[]).map((asset) => ({
          id: String(asset.id),
          assetUrl: String(asset.assetUrl ?? asset.asset_url ?? ""),
          label: asset.label ? String(asset.label) : null,
        }))
      : [],
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
      metadataJson: option.metadata,
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
  }));

  const customFields: ProductCustomField[] = configuration.customFields.map((field, index) => ({
    id: field.id ?? `draft-field-${index}`,
    label: field.label,
    fieldType: field.fieldType,
    placeholder: field.placeholder,
    helpText: field.helpText,
    isRequired: field.isRequired,
    displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
  }));

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
  if (!apiKeyHeader) {
    const fallback = fallbackProducts[0];
    return {
      ...fallback,
      description: "Fallback product for offline mode",
      optionGroups: fallbackConfiguration.optionGroups,
      addOns: fallbackConfiguration.addOns,
      customFields: fallbackConfiguration.customFields,
      subscriptionPlans: fallbackConfiguration.subscriptionPlans,
      fulfillmentSummary: fallbackConfiguration.fulfillmentSummary,
      mediaAssets: [],
      auditLog: [],
    };
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
  return mapProductDetail(payload);
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
        metadata: option.metadata ?? {},
      })),
    })),
    addOns: configuration.addOns.map((addOn, index) => ({
      id: addOn.id,
      label: addOn.label,
      description: addOn.description,
      priceDelta: Number(addOn.priceDelta ?? 0),
      isRecommended: addOn.isRecommended,
      displayOrder: Number.isFinite(addOn.displayOrder) ? addOn.displayOrder : index,
    })),
    customFields: configuration.customFields.map((field, index) => ({
      id: field.id,
      label: field.label,
      fieldType: field.fieldType,
      placeholder: field.placeholder,
      helpText: field.helpText,
      isRequired: field.isRequired,
      displayOrder: Number.isFinite(field.displayOrder) ? field.displayOrder : index,
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

export async function attachProductAsset(
  productId: string,
  assetUrl: string,
  label?: string,
): Promise<void> {
  if (!apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/assets`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ assetUrl, label }),
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
