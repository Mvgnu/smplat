"use client";

import { useFormState, useFormStatus } from "react-dom";

import { triggerGuardrailExportAction } from "@/app/(admin)/admin/reports/actions";
import {
  guardrailExportTriggerInitialState,
  type GuardrailExportTriggerState,
} from "@/lib/admin-report-actions-shared";

type RunGuardrailExportButtonProps = {
  disabled: boolean;
};

export function RunGuardrailExportButton({ disabled }: RunGuardrailExportButtonProps) {
  const [state, formAction] = useFormState<GuardrailExportTriggerState>(
    triggerGuardrailExportAction,
    guardrailExportTriggerInitialState,
  );

  return (
    <form action={formAction} className="space-y-1">
      <SubmitButton disabled={disabled} />
      {state.status === "success" ? (
        <p className="text-xs text-emerald-200">{state.message}</p>
      ) : state.status === "error" ? (
        <p className="text-xs text-rose-300">{state.message}</p>
      ) : null}
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Triggering..." : "Run export now"}
    </button>
  );
}
