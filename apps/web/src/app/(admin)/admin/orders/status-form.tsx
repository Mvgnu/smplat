"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateOrderStatusAction, updateOrderStatusInitialState } from "./actions";
import { ORDER_STATUS_OPTIONS } from "./order-status";

type OrderStatusFormProps = {
  orderId: string;
  currentStatus: string;
  csrfToken: string;
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  active: "Active",
  completed: "Completed",
  on_hold: "On Hold",
  canceled: "Canceled"
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? "Updating..." : "Update status"}
    </button>
  );
}

export function OrderStatusForm({ orderId, currentStatus, csrfToken }: OrderStatusFormProps) {
  const [state, formAction] = useFormState(updateOrderStatusAction, updateOrderStatusInitialState);

  const options = useMemo(() => ORDER_STATUS_OPTIONS.map((value) => ({
    value,
    label: statusLabels[value] ?? value
  })), []);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Order status</span>
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Operator notes</span>
        <textarea
          name="notes"
          placeholder="Describe why the state is changing…"
          className="min-h-[96px] rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-white/50"
          maxLength={500}
        />
      </label>

      {state.error && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Status updated successfully.
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
