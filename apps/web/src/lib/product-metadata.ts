import type {
  CustomFieldVisibilityCondition,
  ProductAddOnMetadata,
  ProductCustomFieldMetadata,
  ProductCustomFieldValidationRules,
  ProductOptionDiscountTier,
  ProductOptionCalculatorMetadata,
  ProductOptionMediaAttachment,
  ProductOptionMetadata,
  ProductOptionStructuredPricing,
  ServiceOverrideCondition,
  ServiceOverrideRule,
} from "@/types/product";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coerceOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const normalizeOptionCalculator = (raw: unknown): ProductOptionCalculatorMetadata | null => {
  if (!isObject(raw)) {
    return null;
  }

  const expression = normalizeTrimmedString(
    (raw as Record<string, unknown>).expression ??
      (raw as Record<string, unknown>).expr ??
      (raw as Record<string, unknown>).formula,
  );
  if (!expression) {
    return null;
  }

  const sampleAmount = coerceOptionalNumber(
    (raw as Record<string, unknown>).sampleAmount ??
      (raw as Record<string, unknown>).sample_amount ??
      (raw as Record<string, unknown>).amount,
  );
  const sampleDays = coerceOptionalNumber(
    (raw as Record<string, unknown>).sampleDays ??
      (raw as Record<string, unknown>).sample_days ??
      (raw as Record<string, unknown>).days,
  );

  const calculator: ProductOptionCalculatorMetadata = {
    expression,
  };
  if (sampleAmount != null) {
    calculator.sampleAmount = sampleAmount;
  }
  if (sampleDays != null) {
    calculator.sampleDays = sampleDays;
  }
  return calculator;
};

export function normalizeStructuredPricing(raw: unknown): ProductOptionStructuredPricing | null {
  if (!isObject(raw)) {
    return null;
  }

  const amount = Number(raw.amount ?? raw.quantity);
  const amountUnitSource = raw.amountUnit ?? raw.unit;
  const amountUnit =
    typeof amountUnitSource === "string" && amountUnitSource.trim().length > 0
      ? amountUnitSource.trim()
      : "";
  const basePrice = Number(raw.basePrice ?? raw.price);
  const unitPriceSource = Number(raw.unitPrice ?? raw.pricePerUnit);
  let drip: number | null = null;
  if (raw.dripMinPerDay != null) {
    const candidate = Number(raw.dripMinPerDay);
    drip = Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (!Number.isFinite(basePrice)) {
    return null;
  }

  const resolvedUnitPrice = Number.isFinite(unitPriceSource)
    ? unitPriceSource
    : Number.isFinite(amount) && amount > 0
      ? Number(basePrice) / amount
      : NaN;

  if (!Number.isFinite(resolvedUnitPrice)) {
    return null;
  }

  if (!amountUnit) {
    return null;
  }

  return {
    amount: Number(amount),
    amountUnit,
    basePrice: Number(basePrice),
    unitPrice: Number(resolvedUnitPrice),
    dripMinPerDay: drip,
    discountTiers: normalizeDiscountTiers(raw.discountTiers),
  };
}

export function normalizeDiscountTiers(raw: unknown): ProductOptionDiscountTier[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const tiers = raw
    .map((entry) => {
      if (!isObject(entry)) {
        return null;
      }
      const minAmount = Number(entry.minAmount ?? entry.minQuantity ?? entry.threshold);
      const unitPrice = Number(entry.unitPrice ?? entry.pricePerUnit ?? entry.price);
      if (!Number.isFinite(minAmount) || minAmount <= 0) {
        return null;
      }
      if (!Number.isFinite(unitPrice)) {
        return null;
      }
      const labelSource = entry.label ?? entry.name ?? entry.note;
      const label =
        typeof labelSource === "string" && labelSource.trim().length > 0
          ? labelSource.trim()
          : null;
      return {
        minAmount: Number(minAmount),
        unitPrice: Number(unitPrice),
        label,
      } satisfies ProductOptionDiscountTier;
    })
    .filter(Boolean) as ProductOptionDiscountTier[];

  return tiers.length > 0 ? tiers : null;
}

export function normalizeMediaAttachments(raw: unknown): ProductOptionMediaAttachment[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const attachments = raw
    .map((entry) => {
      if (!isObject(entry)) {
        return null;
      }
      const assetIdSource = entry.assetId ?? entry.id ?? entry.asset_id;
      if (typeof assetIdSource !== "string" || assetIdSource.trim().length === 0) {
        return null;
      }
      const usageSource = entry.usage ?? entry.slot ?? entry.kind;
      const usage =
        typeof usageSource === "string" && usageSource.trim().length > 0
          ? usageSource.trim()
          : null;
      const usageTagsSource = Array.isArray(entry.usageTags ?? entry.tags)
        ? (entry.usageTags ?? entry.tags)
        : usage
          ? [usage]
          : null;
      const usageTags = Array.isArray(usageTagsSource)
        ? usageTagsSource
            .map((tag) =>
              typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null,
            )
            .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
        : null;
      const labelSource = entry.label ?? entry.caption;
      const label =
        typeof labelSource === "string" && labelSource.trim().length > 0
          ? labelSource.trim()
          : null;
      const altTextSource = entry.altText ?? entry.alt ?? entry.caption;
      const altText =
        typeof altTextSource === "string" && altTextSource.trim().length > 0
          ? altTextSource.trim()
          : null;
      const clientIdSource = entry.clientId ?? entry.localId ?? entry.tempId;
      const clientId =
        typeof clientIdSource === "string" && clientIdSource.trim().length > 0
          ? clientIdSource.trim()
          : null;
      const displayOrderValue = coerceFiniteNumber(
        entry.displayOrder ?? entry.order ?? entry.position,
      );
      const isPrimaryValue = entry.isPrimary ?? entry.primary ?? entry.hero;
      const isPrimary =
        typeof isPrimaryValue === "boolean"
          ? isPrimaryValue
          : typeof isPrimaryValue === "string"
            ? ["true", "1", "yes"].includes(isPrimaryValue.toLowerCase())
            : null;
      const storageKeySource = entry.storageKey ?? entry.storage_key ?? entry.key;
      const storageKey =
        typeof storageKeySource === "string" && storageKeySource.trim().length > 0
          ? storageKeySource.trim()
          : null;
      const checksumSource = entry.checksum ?? entry.hash ?? entry.etag;
      const checksum =
        typeof checksumSource === "string" && checksumSource.trim().length > 0
          ? checksumSource.trim()
          : null;

      return {
        assetId: assetIdSource,
        clientId,
        displayOrder: displayOrderValue,
        isPrimary: isPrimary ?? null,
        usage,
        usageTags: usageTags && usageTags.length > 0 ? usageTags : null,
        label,
        altText,
        storageKey,
        checksum,
      } satisfies ProductOptionMediaAttachment;
    })
    .filter(Boolean) as ProductOptionMediaAttachment[];

  return attachments.length > 0 ? attachments : null;
}

export function normalizeOptionMetadata(raw: unknown): ProductOptionMetadata {
  if (!isObject(raw)) {
    return {};
  }

  const normalized = { ...raw } as ProductOptionMetadata;

  const structuredPricing = normalizeStructuredPricing(raw.structuredPricing ?? raw.structured_pricing);
  if (structuredPricing) {
    normalized.structuredPricing = structuredPricing;
  } else {
    delete normalized.structuredPricing;
  }

  const media = normalizeMediaAttachments(raw.media ?? raw.optionMedia);
  if (media) {
   normalized.media = media;
  } else {
    delete normalized.media;
  }

  const marketingTagline = normalizeTrimmedString(
    (raw as Record<string, unknown>).marketingTagline ??
      (raw as Record<string, unknown>).marketing_tagline ??
      (raw as Record<string, unknown>).marketing_tag_line,
  );
  if (marketingTagline) {
    normalized.marketingTagline = marketingTagline;
  } else {
    delete normalized.marketingTagline;
  }

  const fulfillmentSla = normalizeTrimmedString(
    (raw as Record<string, unknown>).fulfillmentSla ??
      (raw as Record<string, unknown>).fulfillment_sla ??
      (raw as Record<string, unknown>).sla,
  );
  if (fulfillmentSla) {
    normalized.fulfillmentSla = fulfillmentSla;
  } else {
    delete normalized.fulfillmentSla;
  }

  const heroImageUrl = normalizeTrimmedString(
    (raw as Record<string, unknown>).heroImageUrl ??
      (raw as Record<string, unknown>).hero_image_url ??
      (raw as Record<string, unknown>).heroImage,
  );
  if (heroImageUrl) {
    normalized.heroImageUrl = heroImageUrl;
  } else {
    delete normalized.heroImageUrl;
  }

  const calculator = normalizeOptionCalculator(
    (raw as Record<string, unknown>).calculator ?? (raw as Record<string, unknown>).calculatorMetadata,
  );
  if (calculator) {
    normalized.calculator = calculator;
  } else {
    delete normalized.calculator;
  }

  return normalized;
}

export function normalizeAddOnMetadata(raw: unknown): ProductAddOnMetadata {
  if (!isObject(raw)) {
    return {};
  }

  const normalized = { ...raw } as ProductAddOnMetadata;
  const pricingSource = raw.pricing;

  if (isObject(pricingSource)) {
    const mode = typeof pricingSource.mode === "string" ? pricingSource.mode : undefined;
    const amountValue = pricingSource.amount;
    const serviceValue = pricingSource.serviceId ?? pricingSource.service_id;

    if (mode === "flat") {
      const amount = Number(amountValue);
      if (Number.isFinite(amount)) {
        normalized.pricing = { mode, amount };
      } else {
        delete normalized.pricing;
      }
    } else if (mode === "percentage") {
      const amount = Number(amountValue);
      if (Number.isFinite(amount)) {
        normalized.pricing = { mode, amount };
      } else {
        delete normalized.pricing;
      }
    } else if (mode === "serviceOverride") {
      if (typeof serviceValue === "string" && serviceValue.trim().length > 0) {
        const descriptor: NonNullable<ProductAddOnMetadata["pricing"]> = {
          mode,
          serviceId: serviceValue.trim(),
        };
        if (amountValue != null && Number.isFinite(Number(amountValue))) {
          descriptor.amount = Number(amountValue);
        }
        const providerIdSource = pricingSource.providerId ?? pricingSource.provider_id;
        if (typeof providerIdSource === "string" && providerIdSource.trim().length > 0) {
          descriptor.providerId = providerIdSource.trim();
        }
        const costAmountSource = pricingSource.costAmount ?? pricingSource.providerCostAmount;
        if (costAmountSource != null && Number.isFinite(Number(costAmountSource))) {
          descriptor.costAmount = Number(costAmountSource);
        }
        const costCurrencySource = pricingSource.costCurrency ?? pricingSource.providerCostCurrency;
        if (typeof costCurrencySource === "string" && costCurrencySource.trim().length > 0) {
          descriptor.costCurrency = costCurrencySource.trim().toUpperCase();
        }
        const marginTargetSource = pricingSource.marginTarget;
        if (marginTargetSource != null && Number.isFinite(Number(marginTargetSource))) {
          descriptor.marginTarget = Number(marginTargetSource);
        }
        const fulfillmentModeSource = pricingSource.fulfillmentMode ?? pricingSource.fulfillment_mode;
        if (
          typeof fulfillmentModeSource === "string" &&
          ["immediate", "scheduled", "refill"].includes(fulfillmentModeSource)
        ) {
          descriptor.fulfillmentMode = fulfillmentModeSource as "immediate" | "scheduled" | "refill";
        }
        const dripPerDaySource = pricingSource.dripPerDay ?? pricingSource.drip_per_day;
        if (dripPerDaySource != null && Number.isFinite(Number(dripPerDaySource))) {
          descriptor.dripPerDay = Number(dripPerDaySource);
        }
        const payloadTemplateSource =
          pricingSource.payloadTemplate ?? pricingSource.payload_template ?? pricingSource.servicePayload;
        if (isObject(payloadTemplateSource)) {
          descriptor.payloadTemplate = payloadTemplateSource as Record<string, unknown>;
        }
        const previewQuantitySource =
          pricingSource.previewQuantity ?? pricingSource.preview_quantity ?? pricingSource.quantityPreview;
        if (previewQuantitySource != null && Number.isFinite(Number(previewQuantitySource))) {
          descriptor.previewQuantity = Number(previewQuantitySource);
        }
        const rulesSource = pricingSource.rules ?? pricingSource.serviceRules;
        const rules = normalizeServiceOverrideRules(rulesSource);
        if (rules) {
          descriptor.rules = rules;
        }
        normalized.pricing = descriptor as ProductAddOnMetadata["pricing"];
      } else {
        delete normalized.pricing;
      }
    } else {
      delete normalized.pricing;
    }
  } else {
    delete normalized.pricing;
  }

  return normalized;
}

export function serializeOptionMetadata(
  metadata: ProductOptionMetadata | null | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const {
    structuredPricing,
    media,
    recommended,
    marketingTagline,
    fulfillmentSla,
    heroImageUrl,
    calculator,
    ...rest
  } = metadata;
  const payload: Record<string, unknown> = { ...rest };

  if (structuredPricing) {
    const { amount, amountUnit, basePrice, unitPrice, dripMinPerDay, discountTiers } = structuredPricing;
    const structured: Record<string, unknown> = {
      amount,
      amountUnit,
      basePrice,
      unitPrice,
    };
    if (typeof dripMinPerDay === "number") {
      structured.dripMinPerDay = dripMinPerDay;
    }
    if (Array.isArray(discountTiers) && discountTiers.length > 0) {
      structured.discountTiers = discountTiers.map((tier) => {
        const descriptor: Record<string, unknown> = {
          minAmount: tier.minAmount,
          unitPrice: tier.unitPrice,
        };
        if (tier.label) {
          descriptor.label = tier.label;
        }
        return descriptor;
      });
    }
    payload.structuredPricing = structured;
  }

  if (Array.isArray(media) && media.length > 0) {
    payload.media = media.map((attachment) => {
      const descriptor: Record<string, unknown> = {
        assetId: attachment.assetId,
      };
      if (attachment.usage) {
        descriptor.usage = attachment.usage;
      }
      if (attachment.label) {
        descriptor.label = attachment.label;
      }
      return descriptor;
    });
  }

  if (typeof recommended === "boolean") {
    payload.recommended = recommended;
  }

  const serializedMarketingTagline = normalizeTrimmedString(marketingTagline);
  if (serializedMarketingTagline) {
    payload.marketingTagline = serializedMarketingTagline;
  }

  const serializedFulfillmentSla = normalizeTrimmedString(fulfillmentSla);
  if (serializedFulfillmentSla) {
    payload.fulfillmentSla = serializedFulfillmentSla;
  }

  const serializedHeroImageUrl = normalizeTrimmedString(heroImageUrl);
  if (serializedHeroImageUrl) {
    payload.heroImageUrl = serializedHeroImageUrl;
  }

  if (calculator && typeof calculator.expression === "string") {
    const expression = calculator.expression.trim();
    if (expression.length > 0) {
      const descriptor: Record<string, unknown> = {
        expression,
      };
      if (typeof calculator.sampleAmount === "number" && Number.isFinite(calculator.sampleAmount)) {
        descriptor.sampleAmount = calculator.sampleAmount;
      }
      if (typeof calculator.sampleDays === "number" && Number.isFinite(calculator.sampleDays)) {
        descriptor.sampleDays = calculator.sampleDays;
      }
      payload.calculator = descriptor;
    }
  }

  return payload;
}

export function serializeAddOnMetadata(
  metadata: ProductAddOnMetadata | null | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const { pricing, ...rest } = metadata;
  const payload: Record<string, unknown> = { ...rest };

  if (pricing) {
    const descriptor: Record<string, unknown> = {
      mode: pricing.mode,
    };
    if ("amount" in pricing && pricing.amount != null) {
      descriptor.amount = pricing.amount;
    }
    if (pricing.mode === "serviceOverride" && "serviceId" in pricing && pricing.serviceId) {
      descriptor.serviceId = pricing.serviceId;
      if (pricing.providerId) {
        descriptor.providerId = pricing.providerId;
      }
      if (pricing.costAmount != null) {
        descriptor.costAmount = pricing.costAmount;
      }
      if (pricing.costCurrency) {
        descriptor.costCurrency = pricing.costCurrency;
      }
      if (pricing.marginTarget != null) {
        descriptor.marginTarget = pricing.marginTarget;
      }
      if (pricing.fulfillmentMode) {
        descriptor.fulfillmentMode = pricing.fulfillmentMode;
      }
      if (pricing.payloadTemplate) {
        descriptor.payloadTemplate = pricing.payloadTemplate;
      }
      if (pricing.dripPerDay != null) {
        descriptor.dripPerDay = pricing.dripPerDay;
      }
      if (pricing.previewQuantity != null) {
        descriptor.previewQuantity = pricing.previewQuantity;
      }
      if (pricing.rules && pricing.rules.length > 0) {
        descriptor.rules = serializeServiceOverrideRules(pricing.rules);
      }
    }
    payload.pricing = descriptor;
  }

  return payload;
}

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0);
};

export const normalizeServiceOverrideRules = (value: unknown): ServiceOverrideRule[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const rules: ServiceOverrideRule[] = [];
  value.forEach((entry, index) => {
    if (!isObject(entry)) {
      return;
    }
    const idSource = typeof entry.id === "string" ? entry.id.trim() : "";
    const rule: ServiceOverrideRule = {
      id: idSource || `rule-${index + 1}`,
      label: typeof entry.label === "string" ? entry.label.trim() || null : null,
      description: typeof entry.description === "string" ? entry.description.trim() || null : null,
      priority:
        typeof entry.priority === "number" && Number.isFinite(entry.priority)
          ? entry.priority
          : typeof entry.priority === "string" && entry.priority.trim()
            ? Number(entry.priority)
            : null,
      conditions: [],
      overrides: {},
    };
    const conditionsSource = Array.isArray(entry.conditions) ? entry.conditions : [];
    rule.conditions = conditionsSource
      .map((condition) => normalizeServiceOverrideCondition(condition))
      .filter((condition): condition is ServiceOverrideCondition => condition != null);
    if (rule.conditions.length === 0) {
      return;
    }
    rule.overrides = normalizeServiceOverrideOverrides(entry.overrides);
    rules.push(rule);
  });
  return rules.length > 0 ? rules : null;
};

const normalizeServiceOverrideCondition = (raw: unknown): ServiceOverrideCondition | null => {
  if (!isObject(raw)) {
    return null;
  }
  const kindSource = typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = kindSource.toLowerCase();
  if (kind === "channel") {
    const channels = normalizeStringArray(raw.channels ?? raw.values);
    return channels.length > 0 ? { kind: "channel", channels } : null;
  }
  if (kind === "geo" || kind === "region") {
    const regions = normalizeStringArray(raw.regions ?? raw.values);
    return regions.length > 0 ? { kind: "geo", regions } : null;
  }
  if (kind === "option") {
    const optionId = typeof raw.optionId === "string" ? raw.optionId : undefined;
    const optionKey = typeof raw.optionKey === "string" ? raw.optionKey : undefined;
    if (!optionId && !optionKey) {
      return null;
    }
    return { kind: "option", optionId, optionKey };
  }
  if (kind === "amount") {
    const min = coerceOptionalNumber(raw.min ?? raw.minAmount);
    const max = coerceOptionalNumber(raw.max ?? raw.maxAmount);
    if (min == null && max == null) {
      return null;
    }
    return { kind: "amount", min, max };
  }
  if (kind === "drip") {
    const min = coerceOptionalNumber(raw.min ?? raw.minDrip ?? raw.minPerDay);
    const max = coerceOptionalNumber(raw.max ?? raw.maxDrip ?? raw.maxPerDay);
    if (min == null && max == null) {
      return null;
    }
    return { kind: "drip", min, max };
  }
  return null;
};

const normalizeServiceOverrideOverrides = (raw: unknown): ServiceOverrideRule["overrides"] => {
  if (!isObject(raw)) {
    return {};
  }
  const overrides: ServiceOverrideRule["overrides"] = {};
  const serviceId = typeof raw.serviceId === "string" ? raw.serviceId.trim() : undefined;
  if (serviceId) {
    overrides.serviceId = serviceId;
  }
  const providerId = typeof raw.providerId === "string" ? raw.providerId.trim() : undefined;
  if (providerId) {
    overrides.providerId = providerId;
  }
  const costAmount = coerceOptionalNumber(raw.costAmount);
  if (costAmount != null) {
    overrides.costAmount = costAmount;
  }
  const costCurrency = typeof raw.costCurrency === "string" ? raw.costCurrency.trim().toUpperCase() : "";
  if (costCurrency) {
    overrides.costCurrency = costCurrency;
  }
  const marginTarget = coerceOptionalNumber(raw.marginTarget);
  if (marginTarget != null) {
    overrides.marginTarget = marginTarget;
  }
  const fulfillmentMode =
    typeof raw.fulfillmentMode === "string" && ["immediate", "scheduled", "refill"].includes(raw.fulfillmentMode)
      ? (raw.fulfillmentMode as "immediate" | "scheduled" | "refill")
      : undefined;
  if (fulfillmentMode) {
    overrides.fulfillmentMode = fulfillmentMode;
  }
  const dripPerDay = coerceOptionalNumber(raw.dripPerDay);
  if (dripPerDay != null) {
    overrides.dripPerDay = dripPerDay;
  }
  const previewQuantity = coerceOptionalNumber(raw.previewQuantity);
  if (previewQuantity != null) {
    overrides.previewQuantity = previewQuantity;
  }
  if (isObject(raw.payloadTemplate)) {
    overrides.payloadTemplate = raw.payloadTemplate as Record<string, unknown>;
  }
  return overrides;
};

const serializeServiceOverrideRules = (rules: ServiceOverrideRule[]): Record<string, unknown>[] =>
  rules.map((rule) => {
    const payload: Record<string, unknown> = {
      id: rule.id,
      conditions: rule.conditions.map(serializeServiceOverrideCondition),
    };
    if (rule.label) {
      payload.label = rule.label;
    }
    if (rule.description) {
      payload.description = rule.description;
    }
    if (rule.priority != null) {
      payload.priority = rule.priority;
    }
    payload.overrides = serializeServiceOverrideOverrides(rule.overrides);
    return payload;
  });

const serializeServiceOverrideCondition = (condition: ServiceOverrideCondition): Record<string, unknown> => {
  if (condition.kind === "channel") {
    return { kind: "channel", channels: [...condition.channels] };
  }
  if (condition.kind === "geo") {
    return { kind: "geo", regions: [...condition.regions] };
  }
  if (condition.kind === "option") {
    const payload: Record<string, unknown> = { kind: "option" };
    if (condition.optionId) {
      payload.optionId = condition.optionId;
    }
    if (condition.optionKey) {
      payload.optionKey = condition.optionKey;
    }
    return payload;
  }
  if (condition.kind === "amount") {
    const payload: Record<string, unknown> = { kind: "amount" };
    if (condition.min != null) {
      payload.min = condition.min;
    }
    if (condition.max != null) {
      payload.max = condition.max;
    }
    return payload;
  }
  if (condition.kind === "drip") {
    const payload: Record<string, unknown> = { kind: "drip" };
    if (condition.min != null) {
      payload.min = condition.min;
    }
    if (condition.max != null) {
      payload.max = condition.max;
    }
    return payload;
  }
  throw new Error("Unsupported service override condition");
};

const serializeServiceOverrideOverrides = (
  overrides: ServiceOverrideRule["overrides"],
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (overrides.serviceId) {
    payload.serviceId = overrides.serviceId;
  }
  if (overrides.providerId) {
    payload.providerId = overrides.providerId;
  }
  if (overrides.costAmount != null) {
    payload.costAmount = overrides.costAmount;
  }
  if (overrides.costCurrency) {
    payload.costCurrency = overrides.costCurrency;
  }
  if (overrides.marginTarget != null) {
    payload.marginTarget = overrides.marginTarget;
  }
  if (overrides.fulfillmentMode) {
    payload.fulfillmentMode = overrides.fulfillmentMode;
  }
  if (overrides.dripPerDay != null) {
    payload.dripPerDay = overrides.dripPerDay;
  }
  if (overrides.previewQuantity != null) {
    payload.previewQuantity = overrides.previewQuantity;
  }
  if (overrides.payloadTemplate) {
    payload.payloadTemplate = overrides.payloadTemplate;
  }
  return payload;
};

const coerceFiniteNumber = (value: unknown): number | null => {
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? Number(numeric) : null;
};

const normalizeVisibilityCondition = (
  raw: unknown,
): CustomFieldVisibilityCondition | null => {
  if (!isObject(raw)) {
    return null;
  }
  const kindSource = raw.kind ?? raw.type ?? raw.target;
  if (typeof kindSource !== "string") {
    return null;
  }
  const kind = kindSource.toLowerCase();
  if (kind === "option" || kind === "optionId" || kind === "option_key") {
    const optionId = typeof raw.optionId === "string" ? raw.optionId : undefined;
    const optionKey = typeof raw.optionKey === "string" ? raw.optionKey : undefined;
    const groupId = typeof raw.groupId === "string" ? raw.groupId : undefined;
    const groupKey = typeof raw.groupKey === "string" ? raw.groupKey : undefined;
    if (!optionId && !optionKey && !groupId && !groupKey) {
      return null;
    }
    return {
      kind: "option",
      optionId,
      optionKey,
      groupId,
      groupKey,
    };
  }
  if (kind === "addon" || kind === "add_on") {
    const addOnId = typeof raw.addOnId === "string" ? raw.addOnId : undefined;
    const addOnKey = typeof raw.addOnKey === "string" ? raw.addOnKey : undefined;
    if (!addOnId && !addOnKey) {
      return null;
    }
    return {
      kind: "addOn",
      addOnId,
      addOnKey,
    };
  }
  if (kind === "subscriptionplan" || kind === "plan" || kind === "subscription") {
    const planId = typeof raw.planId === "string" ? raw.planId : undefined;
    const planKey = typeof raw.planKey === "string" ? raw.planKey : undefined;
    if (!planId && !planKey) {
      return null;
    }
    return {
      kind: "subscriptionPlan",
      planId,
      planKey,
    };
  }
  if (kind === "channel") {
    const channelSource = raw.channel;
    if (typeof channelSource !== "string" || channelSource.trim().length === 0) {
      return null;
    }
    return {
      kind: "channel",
      channel: channelSource.trim(),
    };
  }
  return null;
};

const normalizeValidationRules = (
  raw: unknown,
): ProductCustomFieldValidationRules | null => {
  if (!isObject(raw)) {
    return null;
  }
  const rules: ProductCustomFieldValidationRules = {};

  const minLength = coerceFiniteNumber(raw.minLength ?? raw.min_length);
  if (minLength != null && minLength >= 0) {
    rules.minLength = minLength;
  }

  const maxLength = coerceFiniteNumber(raw.maxLength ?? raw.max_length);
  if (maxLength != null && maxLength >= 0) {
    rules.maxLength = maxLength;
  }

  const minValue = coerceFiniteNumber(raw.minValue ?? raw.min_value);
  if (minValue != null) {
    rules.minValue = minValue;
  }

  const maxValue = coerceFiniteNumber(raw.maxValue ?? raw.max_value);
  if (maxValue != null) {
    rules.maxValue = maxValue;
  }

  const pattern = raw.pattern;
  if (typeof pattern === "string" && pattern.length > 0) {
    rules.pattern = pattern;
  }

  const regexSource = raw.regex;
  if (isObject(regexSource) || typeof regexSource === "string") {
    if (typeof regexSource === "string") {
      rules.regex = {
        pattern: regexSource,
      };
    } else if (typeof regexSource.pattern === "string" && regexSource.pattern.length > 0) {
      rules.regex = {
        pattern: regexSource.pattern,
      };
      if (typeof regexSource.flags === "string") {
        rules.regex.flags = regexSource.flags;
      }
      if (typeof regexSource.description === "string") {
        rules.regex.description = regexSource.description;
      }
      if (typeof regexSource.sampleValue === "string") {
        rules.regex.sampleValue = regexSource.sampleValue;
      }
    }
  }

  const disallowWhitespace = raw.disallowWhitespace ?? raw.disallow_whitespace;
  if (typeof disallowWhitespace === "boolean") {
    rules.disallowWhitespace = disallowWhitespace;
  } else if (typeof disallowWhitespace === "string") {
    rules.disallowWhitespace =
      ["true", "1", "yes"].includes(disallowWhitespace.toLowerCase());
  }

  const numericStep = coerceFiniteNumber(raw.numericStep ?? raw.step);
  if (numericStep != null && numericStep > 0) {
    rules.numericStep = numericStep;
  }

  const rawRecord = raw as Record<string, unknown>;
  const allowedValuesSource = Array.isArray(rawRecord["allowedValues"])
    ? rawRecord["allowedValues"]
    : Array.isArray(rawRecord["allowed_values"])
      ? rawRecord["allowed_values"]
      : null;
  if (Array.isArray(allowedValuesSource)) {
    const values = (allowedValuesSource as unknown[])
      .map((value: unknown) =>
        typeof value === "string" && value.trim().length > 0 ? value.trim() : null,
      )
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (values.length > 0) {
      rules.allowedValues = values;
    }
  }

  return Object.keys(rules).length > 0 ? rules : null;
};

export function normalizeCustomFieldMetadata(
  raw: unknown,
): ProductCustomFieldMetadata {
  if (!isObject(raw)) {
    return {};
  }

  const metadata = { ...raw } as ProductCustomFieldMetadata;

  const helperTextSource = raw.helperText ?? raw.helperCopy ?? raw.hint;
  if (typeof helperTextSource === "string") {
    metadata.helperText = helperTextSource;
  } else if (helperTextSource == null) {
    delete metadata.helperText;
  }

  const sampleValuesSource = raw.sampleValues ?? raw.samples;
  if (Array.isArray(sampleValuesSource)) {
    const samples = sampleValuesSource
      .map((entry) =>
        typeof entry === "string" && entry.trim().length > 0 ? entry.trim() : null,
      )
      .filter(Boolean) as string[];
    if (samples.length > 0) {
      metadata.sampleValues = samples;
    } else {
      delete metadata.sampleValues;
    }
  } else {
    delete metadata.sampleValues;
  }

  const validation = normalizeValidationRules(raw.validationRules ?? raw.validation);
  if (validation) {
    metadata.validation = validation;
    metadata.validationRules = validation;
  } else {
    delete metadata.validation;
    delete metadata.validationRules;
  }

  const defaultValueSource = raw.defaultValue ?? raw.default_value;
  if (typeof defaultValueSource === "string") {
    metadata.defaultValue = defaultValueSource;
  } else if (defaultValueSource == null) {
    metadata.defaultValue = null;
  } else {
    delete metadata.defaultValue;
  }

  if (isObject(raw.passthrough)) {
    metadata.passthrough = {
      checkout: Boolean(raw.passthrough.checkout),
      fulfillment: Boolean(raw.passthrough.fulfillment),
    };
  } else {
    delete metadata.passthrough;
  }

  const regexTesterSource = raw.regexTester ?? raw.validationTester;
  if (isObject(regexTesterSource)) {
    const sampleValue = normalizeTrimmedString(regexTesterSource.sampleValue);
    const lastResult =
      typeof regexTesterSource.lastResult === "boolean"
        ? regexTesterSource.lastResult
        : typeof regexTesterSource.last_result === "boolean"
          ? regexTesterSource.last_result
          : null;
    if (sampleValue || typeof lastResult === "boolean") {
      metadata.regexTester = {
        sampleValue,
        lastResult: typeof lastResult === "boolean" ? lastResult : null,
      };
    } else {
      delete metadata.regexTester;
    }
  } else {
    delete metadata.regexTester;
  }

  const conditionalSource =
    raw.visibilityRules ?? raw.conditionalVisibility ?? raw.visibility ?? raw.conditional;
  if (isObject(conditionalSource)) {
    const modeSource = conditionalSource.mode ?? conditionalSource.logic ?? "all";
    const mode = modeSource === "any" ? "any" : "all";
    const entries = Array.isArray(conditionalSource.conditions)
      ? conditionalSource.conditions
      : [];
    const conditions = entries
      .map((entry) => normalizeVisibilityCondition(entry))
      .filter((entry): entry is CustomFieldVisibilityCondition => entry != null);
    if (conditions.length > 0) {
      metadata.conditionalVisibility = {
        mode,
        conditions,
      };
      metadata.visibilityRules = metadata.conditionalVisibility;
    } else {
      delete metadata.conditionalVisibility;
      delete metadata.visibilityRules;
    }
  } else {
    delete metadata.conditionalVisibility;
    delete metadata.visibilityRules;
  }

  return metadata;
}

export function serializeCustomFieldMetadata(
  metadata: ProductCustomFieldMetadata | null | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const {
    validation,
    validationRules,
    defaultValue,
    passthrough,
    conditionalVisibility,
    visibilityRules,
    helperText,
    sampleValues,
    regexTester,
    ...rest
  } = metadata;
  const payload: Record<string, unknown> = { ...rest };

  if (helperText !== undefined) {
    payload.helperText = helperText;
  }

  if (Array.isArray(sampleValues)) {
    payload.sampleValues = sampleValues.filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  }

  const resolvedValidation = validationRules ?? validation;
  if (resolvedValidation) {
    const validationPayload: Record<string, unknown> = {};
    if (typeof resolvedValidation.minLength === "number") {
      validationPayload.minLength = resolvedValidation.minLength;
    }
    if (typeof resolvedValidation.maxLength === "number") {
      validationPayload.maxLength = resolvedValidation.maxLength;
    }
    if (typeof resolvedValidation.minValue === "number") {
      validationPayload.minValue = resolvedValidation.minValue;
    }
    if (typeof resolvedValidation.maxValue === "number") {
      validationPayload.maxValue = resolvedValidation.maxValue;
    }
    if (typeof resolvedValidation.pattern === "string") {
      validationPayload.pattern = resolvedValidation.pattern;
    }
    if (resolvedValidation.regex?.pattern) {
      const regexPayload: Record<string, unknown> = {
        pattern: resolvedValidation.regex.pattern,
      };
      if (resolvedValidation.regex.flags) {
        regexPayload.flags = resolvedValidation.regex.flags;
      }
      if (resolvedValidation.regex.description) {
        regexPayload.description = resolvedValidation.regex.description;
      }
      if (resolvedValidation.regex.sampleValue) {
        regexPayload.sampleValue = resolvedValidation.regex.sampleValue;
      }
      validationPayload.regex = regexPayload;
    }
    if (typeof resolvedValidation.disallowWhitespace === "boolean") {
      validationPayload.disallowWhitespace = resolvedValidation.disallowWhitespace;
    }
    if (typeof resolvedValidation.numericStep === "number") {
      validationPayload.numericStep = resolvedValidation.numericStep;
    }
    if (Array.isArray(resolvedValidation.allowedValues)) {
      validationPayload.allowedValues = resolvedValidation.allowedValues;
    }
    if (Object.keys(validationPayload).length > 0) {
      payload.validation = validationPayload;
      payload.validationRules = validationPayload;
    }
  }

  if (defaultValue !== undefined) {
    payload.defaultValue = defaultValue != null ? String(defaultValue) : null;
  }

  if (passthrough) {
    const passthroughPayload: Record<string, unknown> = {};
    if (passthrough.checkout != null) {
      passthroughPayload.checkout = Boolean(passthrough.checkout);
    }
    if (passthrough.fulfillment != null) {
      passthroughPayload.fulfillment = Boolean(passthrough.fulfillment);
    }
    if (Object.keys(passthroughPayload).length > 0) {
      payload.passthrough = passthroughPayload;
    }
  }

  if (conditionalVisibility) {
    const { mode, conditions } = conditionalVisibility;
    if (Array.isArray(conditions) && conditions.length > 0) {
      const descriptorPayload = {
        mode: mode === "any" ? "any" : "all",
        conditions: conditions.map((condition) => {
          const descriptor: Record<string, unknown> = {
            kind: condition.kind,
          };
          if (condition.kind === "option") {
            if (condition.optionId) descriptor.optionId = condition.optionId;
            if (condition.optionKey) descriptor.optionKey = condition.optionKey;
            if (condition.groupId) descriptor.groupId = condition.groupId;
            if (condition.groupKey) descriptor.groupKey = condition.groupKey;
          } else if (condition.kind === "addOn") {
            if (condition.addOnId) descriptor.addOnId = condition.addOnId;
            if (condition.addOnKey) descriptor.addOnKey = condition.addOnKey;
          } else if (condition.kind === "subscriptionPlan") {
            if (condition.planId) descriptor.planId = condition.planId;
            if (condition.planKey) descriptor.planKey = condition.planKey;
          } else if (condition.kind === "channel") {
            descriptor.channel = condition.channel;
          }
          return descriptor;
        }),
      };
      payload.conditionalVisibility = descriptorPayload;
      payload.visibilityRules = descriptorPayload;
    }
  }

  if (visibilityRules && !payload.visibilityRules) {
    payload.visibilityRules = visibilityRules;
  }

  if (regexTester) {
    const testerPayload: Record<string, unknown> = {};
    if (typeof regexTester.sampleValue === "string") {
      testerPayload.sampleValue = regexTester.sampleValue;
    }
    if (typeof regexTester.lastResult === "boolean") {
      testerPayload.lastResult = regexTester.lastResult;
    }
    if (Object.keys(testerPayload).length > 0) {
      payload.regexTester = testerPayload;
    }
  }

  return payload;
}
