"use client";

import { useFormState, useFormStatus } from "react-dom";

import { deleteBundleAction, initialActionState } from "./actions";

type BundleDeleteFormProps = {
  bundleId: string;
  csrfToken: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full border border-red-400/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-red-200 transition hover:border-red-400 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Deleting..." : "Delete"}
    </button>
  );
}

export function BundleDeleteForm({ bundleId, csrfToken }: BundleDeleteFormProps) {
  const [state, action] = useFormState(deleteBundleAction, initialActionState);

  return (
    <form action={action} className="flex flex-col gap-2 text-xs text-white/60">
      <input type="hidden" name="bundleId" value={bundleId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      {state.error && <span className="text-red-200">{state.error}</span>}
      <SubmitButton />
    </form>
  );
}
