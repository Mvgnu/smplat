"use client";

import { useId, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import type { PricingExperiment } from "@/types/pricing-experiments";
import {
  createPricingExperimentAction,
  initialActionState,
  recordPricingExperimentEventAction,
  updatePricingExperimentAction,
} from "./actions";

type VariantDraft = {
  key: string;
  name: string;
  description: string;
  weight: number;
  isControl: boolean;
  adjustmentKind: "delta" | "multiplier";
  priceDeltaCents: number;
  priceMultiplier: number | null;
};

const STATUS_OPTIONS = ["draft", "running", "paused", "completed"] as const;

const createDefaultVariant = (overrides: Partial<VariantDraft> = {}): VariantDraft => ({
  key: "",
  name: "",
  description: "",
  weight: 0,
  isControl: false,
  adjustmentKind: "delta",
  priceDeltaCents: 0,
  priceMultiplier: null,
  ...overrides,
});

const InputLabel = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1 text-sm text-white/80">
    <span className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</span>
    {children}
  </label>
);

const FieldInput = ({
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60"
  />
);

const TextArea = ({
  rows = 3,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    rows={rows}
    {...props}
    className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60"
  />
);

const FormStatusMessage = ({ state, successMessage }: { state: { success: boolean; error: string | null }; successMessage: string }) => {
  if (state.error) {
    return (
      <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-100">
        {state.error}
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
        {successMessage}
      </div>
    );
  }
  return null;
};

const SubmitButton = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving..." : label}
    </button>
  );
};

type VariantEditorProps = {
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
};

function VariantEditor({ variants, onChange }: VariantEditorProps) {
  const updateVariant = (index: number, next: Partial<VariantDraft>) => {
    onChange(
      variants.map((variant, idx) =>
        idx === index
          ? {
              ...variant,
              ...next,
            }
          : variant,
      ),
    );
  };

  const handleIsControlChange = (index: number, checked: boolean) => {
    onChange(
      variants.map((variant, idx) => ({
        ...variant,
        isControl: idx === index ? checked : checked ? false : variant.isControl,
      })),
    );
  };

  const removeVariant = (index: number) => {
    if (variants.length === 1) {
      return;
    }
    onChange(variants.filter((_, idx) => idx !== index));
  };

  return (
    <div className="space-y-4">
      {variants.map((variant, index) => (
        <div key={`${variant.key || "variant"}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">
              Variant {index + 1}
            </p>
            <button
              type="button"
              onClick={() => removeVariant(index)}
              className="text-xs uppercase tracking-[0.3em] text-white/40 transition hover:text-white/80 disabled:opacity-50"
              disabled={variants.length === 1}
            >
              Remove
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InputLabel label="Key">
              <FieldInput
                type="text"
                required
                value={variant.key}
                onChange={(event) => updateVariant(index, { key: event.target.value })}
              />
            </InputLabel>
            <InputLabel label="Name">
              <FieldInput
                type="text"
                required
                value={variant.name}
                onChange={(event) => updateVariant(index, { name: event.target.value })}
              />
            </InputLabel>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <InputLabel label="Weight">
              <FieldInput
                type="number"
                value={variant.weight}
                min={0}
                onChange={(event) => updateVariant(index, { weight: Number(event.target.value) })}
              />
            </InputLabel>
            <InputLabel label="Price delta (cents)">
              <FieldInput
                type="number"
                value={variant.priceDeltaCents}
                onChange={(event) => updateVariant(index, { priceDeltaCents: Number(event.target.value) })}
              />
            </InputLabel>
            <InputLabel label="Price multiplier (optional)">
              <FieldInput
                type="number"
                step="0.01"
                value={variant.priceMultiplier ?? ""}
                onChange={(event) =>
                  updateVariant(index, {
                    priceMultiplier:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </InputLabel>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InputLabel label="Adjustment kind">
              <select
                value={variant.adjustmentKind}
                onChange={(event) =>
                  updateVariant(index, {
                    adjustmentKind: event.target.value === "multiplier" ? "multiplier" : "delta",
                  })
                }
                className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60"
              >
                <option value="delta">Delta</option>
                <option value="multiplier">Multiplier</option>
              </select>
            </InputLabel>
            <InputLabel label="Variant description (optional)">
              <TextArea
                rows={2}
                value={variant.description}
                onChange={(event) => updateVariant(index, { description: event.target.value })}
              />
            </InputLabel>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/60">
            <input
              type="checkbox"
              checked={variant.isControl}
              onChange={(event) => handleIsControlChange(index, event.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-black/60 text-white focus:ring-white"
            />
            Control variant
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...variants, createDefaultVariant()])}
        className="w-full rounded-xl border border-dashed border-white/20 px-3 py-2 text-sm text-white/70 transition hover:border-white/60 hover:text-white"
      >
        + Add variant
      </button>
    </div>
  );
}

export function CreatePricingExperimentForm() {
  const [state, action] = useFormState(createPricingExperimentAction, initialActionState);
  const [variants, setVariants] = useState<VariantDraft[]>([
    createDefaultVariant({ key: "control", name: "Control", isControl: true }),
    createDefaultVariant({ key: "variant-a", name: "Variant A" }),
  ]);
  const variantsPayload = useMemo(() => JSON.stringify(variants), [variants]);

  return (
    <form action={action} className="space-y-4 rounded-3xl border border-white/10 bg-gradient-to-br from-black/60 to-black/20 p-5">
      <h3 className="text-lg font-semibold text-white">Create pricing experiment</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <InputLabel label="Slug">
          <FieldInput name="slug" type="text" required />
        </InputLabel>
        <InputLabel label="Name">
          <FieldInput name="name" type="text" required />
        </InputLabel>
      </div>
      <InputLabel label="Description">
        <TextArea name="description" rows={3} />
      </InputLabel>
      <div className="grid gap-3 md:grid-cols-2">
        <InputLabel label="Target product slug">
          <FieldInput name="targetProductSlug" type="text" required />
        </InputLabel>
        <InputLabel label="Target segment (optional)">
          <FieldInput name="targetSegment" type="text" />
        </InputLabel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <InputLabel label="Feature flag key (optional)">
          <FieldInput name="featureFlagKey" type="text" />
        </InputLabel>
        <InputLabel label="Assignment strategy">
          <FieldInput name="assignmentStrategy" type="text" required />
        </InputLabel>
      </div>
      <input type="hidden" name="variants" value={variantsPayload} readOnly />
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Variants</p>
        <VariantEditor variants={variants} onChange={setVariants} />
      </div>
      <FormStatusMessage state={state} successMessage="Experiment created." />
      <SubmitButton label="Create experiment" />
    </form>
  );
}

type StatusFormProps = {
  experiment: PricingExperiment;
};

export function PricingExperimentStatusForm({ experiment }: StatusFormProps) {
  const [state, action] = useFormState(updatePricingExperimentAction, initialActionState);
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <input type="hidden" name="slug" value={experiment.slug} />
      <InputLabel label="Status">
        <select
          name="status"
          defaultValue={experiment.status}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </InputLabel>
      <InputLabel label="Target segment">
        <FieldInput name="targetSegment" defaultValue={experiment.targetSegment ?? ""} />
      </InputLabel>
      <InputLabel label="Feature flag key">
        <FieldInput name="featureFlagKey" defaultValue={experiment.featureFlagKey ?? ""} />
      </InputLabel>
      <InputLabel label="Assignment strategy">
        <FieldInput name="assignmentStrategy" defaultValue={experiment.assignmentStrategy} />
      </InputLabel>
      <FormStatusMessage state={state} successMessage="Experiment updated." />
      <SubmitButton label="Save changes" />
    </form>
  );
}

type EventFormProps = {
  experiment: PricingExperiment;
};

export function PricingExperimentEventForm({ experiment }: EventFormProps) {
  const [state, action] = useFormState(recordPricingExperimentEventAction, initialActionState);
  const formId = useId();
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <input type="hidden" name="slug" value={experiment.slug} />
      <InputLabel label="Variant">
        <select
          name="variantKey"
          defaultValue={experiment.variants[0]?.key ?? ""}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/60"
        >
          {experiment.variants.map((variant) => (
            <option key={`${formId}-${variant.key}`} value={variant.key}>
              {variant.name} ({variant.key})
            </option>
          ))}
        </select>
      </InputLabel>
      <div className="grid gap-3 md:grid-cols-3">
        <InputLabel label="Exposures">
          <FieldInput name="exposures" type="number" min={0} />
        </InputLabel>
        <InputLabel label="Conversions">
          <FieldInput name="conversions" type="number" min={0} />
        </InputLabel>
        <InputLabel label="Revenue (cents)">
          <FieldInput name="revenueCents" type="number" />
        </InputLabel>
      </div>
      <InputLabel label="Window start (YYYY-MM-DD)">
        <FieldInput name="windowStart" type="date" />
      </InputLabel>
      <FormStatusMessage state={state} successMessage="Metrics recorded." />
      <SubmitButton label="Log metrics" />
    </form>
  );
}
