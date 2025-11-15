"use client";

import Image from "next/image";
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import {
  applyDraftNormalization,
  createAssetDraft,
  type AssetDraft,
  updateUsageDraft,
} from "./types";

type AssetGalleryManagerProps = {
  assetDrafts: AssetDraft[];
  onDraftsChange: (drafts: AssetDraft[]) => void;
  disabled?: boolean;
};

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB guardrail

const describeFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
};

export function AssetGalleryManager({ assetDrafts, onDraftsChange, disabled }: AssetGalleryManagerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPrimaryAsset = useMemo(() => assetDrafts.some((draft) => draft.isPrimary), [assetDrafts]);

  const normalizeAndReplace = useCallback(
    (drafts: AssetDraft[]) => {
      onDraftsChange(applyDraftNormalization(drafts));
    },
    [onDraftsChange],
  );

  const queueFiles = useCallback(
    (input: FileList | File[] | null | undefined) => {
      if (!input || disabled) {
        return;
      }
      const files = Array.from(input).filter((file): file is File => file instanceof File && file.size > 0);
      if (files.length === 0) {
        return;
      }
      const oversize = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
      if (oversize) {
        setError(
          `${oversize.name} exceeds the ${describeFileSize(MAX_FILE_SIZE_BYTES)} limit. Remove large files before uploading.`,
        );
        return;
      }
      setError(null);
      const nextDrafts: AssetDraft[] = assetDrafts.map((draft, index) => ({
        ...draft,
        displayOrder: index,
      }));
      const shouldPromotePrimary = !hasPrimaryAsset && nextDrafts.length === 0;
      files.forEach((file, index) => {
        nextDrafts.push(
          createAssetDraft(file, nextDrafts.length, {
            promoteToPrimary: shouldPromotePrimary && index === 0,
          }),
        );
      });
      normalizeAndReplace(nextDrafts);
    },
    [assetDrafts, disabled, hasPrimaryAsset, normalizeAndReplace],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    queueFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setIsDragActive(false);
    queueFiles(event.dataTransfer?.files ?? null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setIsDragActive(false);
  };

  const updateDraft = (clientId: string, updater: (draft: AssetDraft) => AssetDraft) => {
    normalizeAndReplace(
      assetDrafts.map((draft) => (draft.clientId === clientId ? updater(draft) : draft)),
    );
  };

  const handleUsageChange = (clientId: string, value: string) => {
    updateDraft(clientId, (draft) => updateUsageDraft(draft, value));
  };

  const handleLabelChange = (clientId: string, value: string) => {
    updateDraft(clientId, (draft) => ({ ...draft, label: value }));
  };

  const handleAltTextChange = (clientId: string, value: string) => {
    updateDraft(clientId, (draft) => ({ ...draft, altText: value }));
  };

  const handleRemove = (clientId: string) => {
    const target = assetDrafts.find((draft) => draft.clientId === clientId);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    const nextDrafts = assetDrafts.filter((draft) => draft.clientId !== clientId);
    normalizeAndReplace(nextDrafts);
  };

  const handleMove = (clientId: string, offset: -1 | 1) => {
    const index = assetDrafts.findIndex((draft) => draft.clientId === clientId);
    if (index < 0) {
      return;
    }
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= assetDrafts.length) {
      return;
    }
    const nextDrafts = [...assetDrafts];
    const temp = nextDrafts[targetIndex];
    nextDrafts[targetIndex] = nextDrafts[index];
    nextDrafts[index] = temp;
    normalizeAndReplace(nextDrafts);
  };

  const handlePrimarySelect = (clientId: string) => {
    normalizeAndReplace(
      assetDrafts.map((draft) => ({
        ...draft,
        isPrimary: draft.clientId === clientId,
      })),
    );
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/30">
      <header className="flex flex-col gap-2 text-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Media</p>
            <h2 className="text-lg font-semibold text-white">Asset gallery</h2>
          </div>
          <div className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
            {assetDrafts.length} queued
          </div>
        </div>
        <p className="text-sm text-white/60">
          Queue assets now and we will upload them as soon as the product is saved. Set labels, usage tags, and the
          primary image to keep storefront previews aligned.
        </p>
      </header>

      <input
        type="file"
        ref={fileInputRef}
        multiple
        hidden
        accept="image/*,video/*"
        onChange={handleInputChange}
        disabled={disabled}
      />

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
          isDragActive ? "border-emerald-400 bg-emerald-500/10" : "border-white/20 bg-black/20"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        onClick={() => {
          if (!disabled) {
            fileInputRef.current?.click();
          }
        }}
      >
        <span className="text-sm text-white/70">
          {disabled
            ? "Asset uploads are temporarily disabled."
            : isDragActive
              ? "Release to add assets"
              : "Drag files here or click to browse"}
        </span>
        <span className="mt-2 text-xs text-white/50">
          JPG, PNG, MP4, and GIF up to {describeFileSize(MAX_FILE_SIZE_BYTES)} each.
        </span>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {assetDrafts.length > 0 ? (
        <ul className="space-y-3">
          {assetDrafts.map((asset, index) => (
            <li key={asset.clientId} className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                {asset.previewUrl ? (
                  <Image
                    src={asset.previewUrl}
                    alt={asset.label || `Queued asset ${index + 1}`}
                    width={96}
                    height={96}
                    unoptimized
                    className="h-24 w-24 rounded-lg border border-white/20 object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border border-white/20 text-xs text-white/60">
                    <span className="truncate px-2 text-center">{asset.file.type || "File"}</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                      {describeFileSize(asset.file.size)}
                    </span>
                  </div>
                )}
                <div className="flex-1 space-y-4 text-xs text-white/70">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      Label
                      <input
                        value={asset.label}
                        onChange={(event) => handleLabelChange(asset.clientId, event.target.value)}
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        disabled={disabled}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Alt text
                      <input
                        value={asset.altText}
                        onChange={(event) => handleAltTextChange(asset.clientId, event.target.value)}
                        className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                        disabled={disabled}
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    Usage tags (comma or newline separated)
                    <textarea
                      value={asset.usageDraft}
                      onChange={(event) => handleUsageChange(asset.clientId, event.target.value)}
                      rows={2}
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
                      placeholder="hero, product-page, instagram"
                      disabled={disabled}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-4 text-white/80">
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
                      <input
                        type="radio"
                        name="primaryAsset"
                        checked={asset.isPrimary}
                        onChange={() => handlePrimarySelect(asset.clientId)}
                        disabled={disabled}
                        className="h-4 w-4 accent-emerald-400"
                      />
                      Primary image
                    </label>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                      {asset.usageTags.length > 0 ? asset.usageTags.join(", ") : "No tags"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleMove(asset.clientId, -1)}
                      disabled={disabled || index === 0}
                      className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(asset.clientId, 1)}
                      disabled={disabled || index === assetDrafts.length - 1}
                      className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(asset.clientId)}
                    disabled={disabled}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-white/50">No assets queued yet.</p>
      )}
    </section>
  );
}
