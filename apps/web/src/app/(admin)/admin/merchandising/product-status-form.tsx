"use client";

import { useFormState, useFormStatus } from "react-dom";

import { initialActionState, updateProductStatusAction } from "./actions";

type ProductStatusFormProps = {
  productId: string;
  currentStatus: "draft" | "active" | "archived";
  csrfToken: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Live",
  archived: "Archived",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Saving..." : "Save status"}
    </button>
  );
}

export function ProductStatusForm({ productId, currentStatus, csrfToken }: ProductStatusFormProps) {
  const [state, action] = useFormState(updateProductStatusAction, initialActionState);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Product status</span>
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        >
          {(["draft", "active", "archived"] as const).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      {state.error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Status updated.
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
