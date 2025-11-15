"use client";

import { useFormState, useFormStatus } from "react-dom";

import { initialActionState, upsertBundleAction } from "./actions";

type BundleFormProps = {
  csrfToken: string;
  bundle?: {
    id: string;
    primaryProductSlug: string;
    bundleSlug: string;
    title: string;
    description: string | null;
    savingsCopy: string | null;
    cmsPriority: number;
    components: string[];
  };
};

function SubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Saving..." : isEditing ? "Update bundle" : "Create bundle"}
    </button>
  );
}

export function BundleForm({ csrfToken, bundle }: BundleFormProps) {
  const [state, action] = useFormState(upsertBundleAction, initialActionState);
  const isEditing = Boolean(bundle);
  const componentsValue = bundle?.components.join("\n") ?? "";

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      {bundle?.id ? <input type="hidden" name="bundleId" value={bundle.id} /> : null}
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Primary product slug</span>
        <input
          type="text"
          name="primaryProductSlug"
          defaultValue={bundle?.primaryProductSlug ?? ""}
          required
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Bundle slug</span>
        <input
          type="text"
          name="bundleSlug"
          defaultValue={bundle?.bundleSlug ?? ""}
          required
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Title</span>
        <input
          type="text"
          name="title"
          defaultValue={bundle?.title ?? ""}
          required
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Description</span>
        <textarea
          name="description"
          defaultValue={bundle?.description ?? ""}
          rows={3}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Savings copy</span>
        <input
          type="text"
          name="savingsCopy"
          defaultValue={bundle?.savingsCopy ?? ""}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">CMS priority</span>
        <input
          type="number"
          name="cmsPriority"
          defaultValue={bundle?.cmsPriority ?? 100}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Component slugs</span>
        <textarea
          name="components"
          defaultValue={componentsValue}
          placeholder="One slug per line"
          rows={3}
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>

      {state.error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          {isEditing ? "Bundle updated." : "Bundle created."}
        </div>
      )}

      <SubmitButton isEditing={isEditing} />
    </form>
  );
}
