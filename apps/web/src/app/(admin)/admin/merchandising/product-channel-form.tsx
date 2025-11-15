"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { initialActionState, updateProductChannelsAction } from "./actions";

const CHANNEL_OPTIONS = [
  { value: "storefront", label: "Storefront" },
  { value: "loyalty", label: "Loyalty" },
  { value: "referral", label: "Referral" },
  { value: "dashboard", label: "Client dashboard" },
];

type ProductChannelFormProps = {
  productId: string;
  activeChannels: string[];
  csrfToken: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Saving..." : "Save channels"}
    </button>
  );
}

export function ProductChannelForm({ productId, activeChannels, csrfToken }: ProductChannelFormProps) {
  const [state, action] = useFormState(updateProductChannelsAction, initialActionState);
  const selected = useMemo(() => new Set(activeChannels.map((value) => value.toLowerCase())), [activeChannels]);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <fieldset className="flex flex-col gap-2 text-sm text-white/70">
        <legend className="text-xs uppercase tracking-[0.3em] text-white/40">Eligible channels</legend>
        {CHANNEL_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="channels"
              value={option.value}
              defaultChecked={selected.has(option.value)}
              className="h-4 w-4 rounded border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      {state.error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Channels updated.
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
