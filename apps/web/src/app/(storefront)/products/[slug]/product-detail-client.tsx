"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { FaqAccordion } from "@/components/faq/accordion";
import {
  ProductConfigurator,
  type ConfiguratorAddOn,
  type ConfiguratorCustomField,
  type ConfiguratorOptionGroup,
  type ConfiguratorSelection,
  type SubscriptionPlan
} from "@/components/products/product-configurator";
import { useCartStore, cartTotalSelector } from "@/store/cart";
import {
  useSavedConfigurationsStore,
  type SavedConfiguration
} from "@/store/saved-configurations";
import type { ProductDetail, ProductOptionGroup } from "@/types/product";
import type { CatalogBundleRecommendation, CatalogExperimentResponse } from "@smplat/types";
import {
  buildBundleExperimentOverlay,
  hasGuardrailBreaches,
} from "../experiment-overlay";
import type { MarketingContent } from "../marketing-content";

type ConfigSelection = {
  total: number;
  selectedOptions: Record<string, string[]>;
  addOns: string[];
  subscriptionPlanId?: string;
  customFieldValues: Record<string, string>;
};

type SelectedOptionDetail = {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  priceDelta: number;
};

type SelectedAddOnDetail = {
  id: string;
  label: string;
  priceDelta: number;
};

type ProductDetailClientProps = {
  product: ProductDetail;
  marketing: MarketingContent;
  recommendations: CatalogBundleRecommendation[];
  recommendationFallback?: string | null;
  experiments: CatalogExperimentResponse[];
};

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
      options: group.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? undefined,
          priceDelta: option.priceDelta,
          recommended: option.metadataJson?.recommended === true
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
      recommended: addOn.isRecommended
    }));
}

function mapCustomFields(fields: ProductDetail["customFields"]): ConfiguratorCustomField[] {
  return fields
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((field) => ({
      id: field.id,
      label: field.label,
      type: field.fieldType,
      placeholder: field.placeholder ?? undefined,
      helpText: field.helpText ?? undefined,
      required: field.isRequired
    }));
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
    customFieldValues: { ...selection.customFieldValues }
  };
}

type PriceBreakdownItem = {
  id: string;
  label: string;
  amount: number;
  variant: "base" | "option" | "addOn" | "plan";
};

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
      items.push({
        id: `option-${group.id}-${option.id}`,
        label: `${group.name}: ${option.label}`,
        amount: option.priceDelta,
        variant: "option"
      });
      running += option.priceDelta;
    });
  });

  selection.addOns.forEach((id) => {
    const addOn = product.addOns.find((item) => item.id === id);
    if (!addOn) {
      return;
    }
    items.push({
      id: `addon-${addOn.id}`,
      label: addOn.label,
      amount: addOn.priceDelta,
      variant: "addOn"
    });
    running += addOn.priceDelta;
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
}: ProductDetailClientProps) {
  const [selection, setSelection] = useState<ConfigSelection>({
    total: product.basePrice,
    selectedOptions: {},
    addOns: [],
    subscriptionPlanId: product.subscriptionPlans.find((plan) => plan.isDefault)?.id,
    customFieldValues: {}
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [configPreset, setConfigPreset] = useState<ConfiguratorSelection | undefined>(undefined);

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

  const handleConfiguratorChange = (next: ConfigSelection) => {
    setSelection(next);
    setErrors([]);
    setConfirmation(null);
  };

  const validateCustomFields = (): string[] => {
    const missing: string[] = [];
    customFields.forEach((field) => {
      if (field.required) {
        const value = selection.customFieldValues[field.id];
        if (!value || value.trim().length === 0) {
          missing.push(`${field.label} is required`);
        }
      }
    });
    return missing;
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
    setConfigPreset({
      selectedOptions: Object.fromEntries(
        Object.entries(config.selection.selectedOptions).map(([groupId, optionIds]) => [
          groupId,
          [...optionIds]
        ])
      ),
      addOns: [...config.selection.addOns],
      subscriptionPlanId: config.selection.subscriptionPlanId,
      customFieldValues: { ...config.selection.customFieldValues }
    });
    setConfirmation(`Applied "${config.label}" configuration.`);
    setErrors([]);
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

    const selectedOptionDetails: SelectedOptionDetail[] = product.optionGroups.flatMap((group) => {
      const ids = selection.selectedOptions[group.id] ?? [];
      return ids
        .map((id) => {
          const option = group.options.find((opt) => opt.id === id);
          if (!option) {
            return null;
          }
          return {
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            label: option.label,
            priceDelta: option.priceDelta
          };
        })
        .filter((option): option is SelectedOptionDetail => option !== null);
    });

    const selectedAddOnDetails: SelectedAddOnDetail[] = product.addOns
      .filter((addOn) => selection.addOns.includes(addOn.id))
      .map((addOn) => ({
        id: addOn.id,
        label: addOn.label,
        priceDelta: addOn.priceDelta
      }));

    const subscriptionSelection = selection.subscriptionPlanId
      ? product.subscriptionPlans.find((plan) => plan.id === selection.subscriptionPlanId)
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
      supportChannels: product.fulfillmentSummary?.support ?? []
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
        <div className="grid gap-8 lg:grid-cols-[2fr,1fr]">
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
        </div>
      </header>

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

      <ProductConfigurator
        basePrice={product.basePrice}
        currency={product.currency}
        optionGroups={optionGroups}
        addOns={addOns}
        customFields={customFields}
        subscriptionPlans={subscriptionPlans}
        initialConfig={configPreset}
        onChange={handleConfiguratorChange}
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
