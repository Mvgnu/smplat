import type {
  ProductAddOnMetadata,
  ProductAddOnPricingSnapshot,
  ProductOption,
  ProductOptionGroup,
  ServiceOverrideRule,
} from "@/types/product";

const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const formatCurrency = (amount: number, currency: string): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

export function calculateOptionDelta(
  option: Pick<ProductOption, "priceDelta" | "metadataJson"> & {
    structuredPricing?: { basePrice?: number | null } | null;
  },
  basePrice: number,
  groupType: ProductOptionGroup["groupType"],
): number {
  const structured = option.metadataJson?.structuredPricing ?? option.structuredPricing ?? null;
  if (structured && typeof structured.basePrice === "number" && Number.isFinite(structured.basePrice)) {
    if (groupType === "single") {
      return structured.basePrice - basePrice;
    }
    return structured.basePrice;
  }
  return option.priceDelta;
}

export type AddOnPricingInfo = {
  mode?: "flat" | "percentage" | "serviceOverride";
  amount?: number | null;
  serviceId?: string | null;
  percentageMultiplier?: number | null;
  serviceAction?: string | null;
  serviceProviderId?: string | null;
  serviceProviderName?: string | null;
  serviceDescriptor?: Record<string, unknown> | null;
  providerCostAmount?: number | null;
  providerCostCurrency?: string | null;
  marginTarget?: number | null;
  fulfillmentMode?: "immediate" | "scheduled" | "refill";
  payloadTemplate?: Record<string, unknown> | null;
  dripPerDay?: number | null;
  previewQuantity?: number | null;
  serviceRules?: ServiceOverrideRule[] | null;
};

type AddOnPricingSource = {
  priceDelta: number;
  computedDelta?: number;
  metadataJson?: ProductAddOnMetadata | null;
  metadata?: ProductAddOnMetadata | null;
  pricing?: ProductAddOnPricingSnapshot | null;
};

export function getAddOnPricingInfo(
  metadata?: ProductAddOnMetadata | null,
  snapshot?: ProductAddOnPricingSnapshot | null,
): AddOnPricingInfo {
  if (snapshot && snapshot.mode) {
    const info: AddOnPricingInfo = {
      mode: snapshot.mode,
      amount: snapshot.amount ?? null,
      percentageMultiplier: snapshot.percentageMultiplier ?? null,
      serviceId: snapshot.serviceId ?? null,
      serviceAction: snapshot.serviceAction ?? null,
      serviceProviderId: snapshot.serviceProviderId ?? null,
      serviceProviderName: snapshot.serviceProviderName ?? null,
      serviceDescriptor: snapshot.serviceDescriptor ?? null,
      providerCostAmount: snapshot.providerCostAmount ?? null,
      providerCostCurrency: snapshot.providerCostCurrency ?? null,
      marginTarget: snapshot.marginTarget ?? null,
      fulfillmentMode: snapshot.fulfillmentMode ?? undefined,
      payloadTemplate: snapshot.payloadTemplate ?? null,
      dripPerDay: snapshot.dripPerDay ?? null,
      previewQuantity: snapshot.previewQuantity ?? null,
      serviceRules: snapshot.serviceRules ?? null,
    };
    return info;
  }

  const pricing = metadata?.pricing;
  if (!pricing) {
    return {};
  }

  if (pricing.mode === "flat") {
    return { mode: "flat", amount: pricing.amount ?? null };
  }

  if (pricing.mode === "percentage") {
    return { mode: "percentage", amount: pricing.amount ?? null, percentageMultiplier: pricing.amount ?? null };
  }

  if (pricing.mode === "serviceOverride") {
    const info: AddOnPricingInfo = {
      mode: "serviceOverride",
      amount: pricing.amount ?? null,
      serviceId: pricing.serviceId ?? null,
    };
    if (pricing.providerId) {
      info.serviceProviderId = pricing.providerId;
    }
    if (pricing.previewQuantity != null) {
      info.previewQuantity = pricing.previewQuantity;
    }
    if (pricing.costAmount != null) {
      info.providerCostAmount = pricing.costAmount;
    }
    if (pricing.costCurrency) {
      info.providerCostCurrency = pricing.costCurrency;
    }
    if (pricing.marginTarget != null) {
      info.marginTarget = pricing.marginTarget;
    }
    if (pricing.fulfillmentMode) {
      info.fulfillmentMode = pricing.fulfillmentMode;
    }
    if (pricing.payloadTemplate) {
      info.payloadTemplate = pricing.payloadTemplate;
    }
    if (pricing.dripPerDay != null) {
      info.dripPerDay = pricing.dripPerDay;
    }
    if (pricing.rules) {
      info.serviceRules = pricing.rules;
    }
    return info;
  }

  return {};
}

export function calculateAddOnDelta(addOn: AddOnPricingSource, subtotal: number): number {
  const metadata = addOn.metadataJson ?? addOn.metadata ?? null;
  const info = getAddOnPricingInfo(metadata, addOn.pricing ?? null);

  if (info.mode === "flat" && typeof info.amount === "number") {
    return info.amount;
  }

  if (info.mode === "percentage" && typeof info.amount === "number") {
    return roundCurrency(subtotal * info.amount);
  }

  if (info.mode === "serviceOverride") {
    if (typeof info.amount === "number") {
      return info.amount;
    }
    if (typeof addOn.computedDelta === "number") {
      return addOn.computedDelta;
    }
    return addOn.priceDelta;
  }

  if (typeof addOn.computedDelta === "number") {
    return addOn.computedDelta;
  }
  return addOn.priceDelta;
}

export function formatAddOnPreview(info: AddOnPricingInfo, fallbackDelta: number, currency: string): {
  primary: string;
  secondary?: string;
} {
  if (info.mode === "percentage" && typeof info.amount === "number") {
    const percent = (info.amount * 100).toFixed(1).replace(/\.0$/, "");
    return { primary: `${percent}% of subtotal` };
  }

  if (info.mode === "serviceOverride") {
    const amount = info.amount != null ? info.amount : fallbackDelta;
    const primary = `${amount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(amount), currency)}`;
    const secondaryParts: string[] = [];
    if (info.serviceProviderName) {
      secondaryParts.push(info.serviceProviderName);
    } else if (info.serviceId) {
      secondaryParts.push(`Service ${info.serviceId}`);
    }
    if (typeof info.providerCostAmount === "number") {
      const costCurrency = info.providerCostCurrency || currency;
      secondaryParts.push(`Cost ${formatCurrency(Math.abs(info.providerCostAmount), costCurrency)}`);
    }
    if (typeof info.marginTarget === "number") {
      secondaryParts.push(`Margin ${info.marginTarget}%`);
    }
    if (info.fulfillmentMode) {
      secondaryParts.push(info.fulfillmentMode);
    }
    if (typeof info.dripPerDay === "number") {
      secondaryParts.push(`${info.dripPerDay}/day`);
    }
    return { primary, secondary: secondaryParts.length > 0 ? secondaryParts.join(" · ") : undefined };
  }

  const amount = info.amount != null ? info.amount : fallbackDelta;
  const primary = `${amount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(amount), currency)}`;
  return { primary };
}

export function formatAppliedAddOnLabel(
  info: AddOnPricingInfo,
  delta: number,
  currency: string,
): { primary: string; secondary?: string } {
  const absolute = formatCurrency(Math.abs(delta), currency);
  const baseLabel = `${delta >= 0 ? "+" : "-"}${absolute}`;

  if (info.mode === "percentage" && typeof info.amount === "number") {
    const percent = (info.amount * 100).toFixed(1).replace(/\.0$/, "");
   return { primary: baseLabel, secondary: `${percent}% subtotal` };
  }

  if (info.mode === "serviceOverride") {
    const secondaryParts: string[] = [];
    if (info.serviceProviderName) {
      secondaryParts.push(info.serviceProviderName);
    } else if (info.serviceId) {
      secondaryParts.push(`service ${info.serviceId}`);
    }
    if (typeof info.providerCostAmount === "number") {
      const costCurrency = info.providerCostCurrency || currency;
      secondaryParts.push(`cost ${formatCurrency(Math.abs(info.providerCostAmount), costCurrency)}`);
    }
    if (typeof info.marginTarget === "number") {
      secondaryParts.push(`margin ${info.marginTarget}%`);
    }
    if (info.fulfillmentMode) {
      secondaryParts.push(info.fulfillmentMode);
    }
    if (typeof info.dripPerDay === "number") {
      secondaryParts.push(`${info.dripPerDay}/day`);
    }
    if (typeof info.previewQuantity === "number") {
      secondaryParts.push(`preview ${info.previewQuantity}`);
    }
    if (secondaryParts.length > 0) {
      return { primary: baseLabel, secondary: secondaryParts.join(" · ") };
    }
  }

  return { primary: baseLabel };
}
