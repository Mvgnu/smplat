"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

import type { ActionState } from "./actions";

export function ActionButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Working..." : children}
    </button>
  );
}

export function DangerButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Working..." : children}
    </button>
  );
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.success && !state.error) {
    return null;
  }
  return (
    <p
      className={`text-xs ${
        state.success ? "text-emerald-300" : "text-rose-300"
      }`}
    >
      {state.success ? "Updated" : state.error}
    </p>
  );
}
