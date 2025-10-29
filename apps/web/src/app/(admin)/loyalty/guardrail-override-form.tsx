"use client";

import { useFormState, useFormStatus } from "react-dom";

import type { LoyaltyGuardrailOverrideScope } from "@smplat/types";

import {
  guardrailOverrideAction,
  guardrailOverrideInitialState
} from "./actions";

const scopeLabels: Record<LoyaltyGuardrailOverrideScope, string> = {
  invite_quota: "Invite quota",
  invite_cooldown: "Referral cooldown",
  global_throttle: "Global throttle"
};

type GuardrailOverrideFormProps = {
  csrfToken: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      data-testid="guardrail-override-submit"
      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? "Applying override..." : "Apply override"}
    </button>
  );
}

export function GuardrailOverrideForm({ csrfToken }: GuardrailOverrideFormProps) {
  const [state, formAction] = useFormState(guardrailOverrideAction, guardrailOverrideInitialState);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/30 p-4"
      data-testid="guardrail-override-form"
    >
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <label className="flex flex-col gap-2 text-sm text-white/80">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Guardrail scope</span>
        <select
          name="scope"
          defaultValue="invite_cooldown"
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
          data-testid="guardrail-override-scope"
        >
          {(Object.keys(scopeLabels) as LoyaltyGuardrailOverrideScope[]).map((scope) => (
            <option key={scope} value={scope}>
              {scopeLabels[scope]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2 text-sm text-white/80">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Justification</span>
        <textarea
          name="justification"
          rows={3}
          placeholder="Capture the operator reasoning for this override"
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
          data-testid="guardrail-override-justification"
          required
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-2 text-sm text-white/80">
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Target member ID</span>
          <input
            name="targetMemberId"
            placeholder="Optional"
            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
            data-testid="guardrail-override-member"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-white/80">
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Expires in (minutes)</span>
          <input
            name="expiresInMinutes"
            type="number"
            min={5}
            step={5}
            placeholder="60"
            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
            data-testid="guardrail-override-expiry"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-white/80">
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Notes</span>
          <input
            name="notes"
            placeholder="Visible in audit trail"
            className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
          />
        </label>
      </div>

      {state.error && (
        <div
          className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
          data-testid="guardrail-override-error"
        >
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100"
          data-testid="guardrail-override-success"
        >
          {state.success}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
