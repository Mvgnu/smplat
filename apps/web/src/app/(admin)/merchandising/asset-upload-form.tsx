"use client";

import { useFormState, useFormStatus } from "react-dom";

import { initialActionState, uploadProductAssetAction } from "./actions";

type AssetUploadFormProps = {
  productId: string;
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
      {pending ? "Uploading..." : "Upload asset"}
    </button>
  );
}

export function AssetUploadForm({ productId, csrfToken }: AssetUploadFormProps) {
  const [state, action] = useFormState(uploadProductAssetAction, initialActionState);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4" encType="multipart/form-data">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Asset label</span>
        <input
          type="text"
          name="label"
          placeholder="e.g. hero-banner.png"
          className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none transition focus:border-white/50"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-white/70">
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">Upload file</span>
        <input
          type="file"
          name="assetFile"
          accept="image/*,video/*"
          className="text-xs text-white/60"
          required
        />
      </label>

      {state.error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {state.error}
        </div>
      )}

      {state.success && !state.error && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Asset uploaded.
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
