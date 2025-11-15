"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";

import {
  runOrderJourneyAutomationAction,
  runOrderJourneyAutomationInitialState,
  type RunJourneyAutomationState,
} from "./actions";

type JourneyAutomationFormProps = {
  orderId: string;
  products: Array<{ id: string; title: string }>;
  csrfToken: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? "Queuing…" : "Run automation journeys"}
    </button>
  );
}

export function JourneyAutomationForm({ orderId, products, csrfToken }: JourneyAutomationFormProps) {
  const [state, formAction] = useFormState<RunJourneyAutomationState, FormData>(
    runOrderJourneyAutomationAction,
    runOrderJourneyAutomationInitialState,
  );
  const productOptions = useMemo(() => {
    const unique = new Map<string, string>();
    products.forEach((product) => {
      if (product.id) {
        unique.set(product.id, product.title);
      }
    });
    return Array.from(unique.entries()).map(([id, title]) => ({ id, title }));
  }, [products]);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/80"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <label className="flex flex-col gap-2 text-xs text-white/70">
        Product scope
        <select
          name="productId"
          className="rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
          defaultValue=""
        >
          <option value="">All journey-enabled products</option>
          {productOptions.map((product) => (
            <option key={product.id} value={product.id}>
              {product.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-xs text-white/70">
        Run reason (optional)
        <input
          name="reason"
          placeholder="Automation backfill, manual replay, etc."
          className="rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
        />
      </label>
      {state.error ? (
        <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {state.error}
        </div>
      ) : null}
      {state.success && state.runsTriggered ? (
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {state.runsTriggered} run{state.runsTriggered === 1 ? "" : "s"} queued successfully.
        </div>
      ) : null}
      <div className="flex items-center justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
