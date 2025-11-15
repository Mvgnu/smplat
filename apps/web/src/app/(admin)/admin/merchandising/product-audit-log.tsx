"use client";

import { useFormState, useFormStatus } from "react-dom";

import { initialActionState, restoreProductFromAuditAction } from "./actions";

type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
};

type ProductAuditLogProps = {
  entries: AuditEntry[];
  csrfToken: string;
};

function RestoreButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Restoring..." : "Restore"}
    </button>
  );
}

export function ProductAuditLog({ entries, csrfToken }: ProductAuditLogProps) {
  const [state, action] = useFormState(restoreProductFromAuditAction, initialActionState);

  if (entries.length === 0) {
    return <p className="text-xs text-white/50">No audit entries yet.</p>;
  }

  return (
    <div className="space-y-2 text-xs text-white/60">
      {state.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-100">{state.error}</div>}
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2">
            <div className="flex flex-col">
              <span className="font-semibold text-white/80">{entry.action}</span>
              <time className="text-white/40" dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </div>
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="logId" value={entry.id} />
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <RestoreButton />
            </form>
          </li>
        ))}
      </ul>
      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-100">
          Product restored from selected audit entry.
        </div>
      )}
    </div>
  );
}
