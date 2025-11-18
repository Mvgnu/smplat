'use client';

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { uploadProductAssetAction } from "./actions";

type AssetUploadFormProps = {
  productId: string;
  csrfToken: string;
};

type AssetDraft = {
  id: string;
  file: File;
  label: string;
  altText: string;
  usageTags: string;
  displayOrder: number;
  previewUrl: string | null;
};

type QueueState = "idle" | "pending" | "success" | "error";

const generateKey = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export function AssetUploadForm({ productId, csrfToken }: AssetUploadFormProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<AssetDraft[]>([]);
  const [queueState, setQueueState] = useState<QueueState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPending, startTransition] = useTransition();

  const queuedAssets = useMemo(
    () => drafts.slice().sort((a, b) => a.displayOrder - b.displayOrder),
    [drafts]
  );

  const totalBytes = useMemo(
    () => queuedAssets.reduce((accumulator, draft) => accumulator + draft.file.size, 0),
    [queuedAssets]
  );

  useEffect(
    () => () => {
      drafts.forEach((draft) => {
        if (draft.previewUrl) {
          URL.revokeObjectURL(draft.previewUrl);
        }
      });
    },
    [drafts]
  );

  const appendFiles = useCallback((input: FileList | File[] | null | undefined) => {
    if (!input) {
      return;
    }
    const files = Array.from(input).filter((file) => file instanceof File && file.size > 0);
    if (files.length === 0) {
      return;
    }

    setDrafts((previous) => {
      const baseOrder = previous.length;
      const nextDrafts = files.map<AssetDraft>((file, index) => ({
        id: generateKey("asset"),
        file,
        label: file.name,
        altText: "",
        usageTags: "",
        displayOrder: baseOrder + index,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      }));
      return [...previous, ...nextDrafts];
    });
  }, []);

  const handleFilesFromInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      appendFiles(event.target.files);
      event.target.value = "";
    },
    [appendFiles]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      appendFiles(event.dataTransfer?.files ?? null);
    },
    [appendFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  }, []);

  const updateDraft = useCallback(
    (id: string, updater: (draft: AssetDraft) => AssetDraft) => {
      setDrafts((previous) => previous.map((draft) => (draft.id === id ? updater(draft) : draft)));
    },
    []
  );

  const removeDraft = useCallback((id: string) => {
    setDrafts((previous) => {
      const target = previous.find((draft) => draft.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const filtered = previous.filter((draft) => draft.id !== id);
      return filtered.map((draft, index) => ({ ...draft, displayOrder: index }));
    });
  }, []);

  const reorderDraft = useCallback((id: string, direction: "up" | "down") => {
    setDrafts((previous) => {
      const index = previous.findIndex((draft) => draft.id === id);
      if (index < 0) {
        return previous;
      }
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }
      const copy = [...previous];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, moved);
      return copy.map((draft, order) => ({ ...draft, displayOrder: order }));
    });
  }, []);

  const resetQueue = useCallback(() => {
    setDrafts((previous) => {
      previous.forEach((draft) => {
        if (draft.previewUrl) {
          URL.revokeObjectURL(draft.previewUrl);
        }
      });
      return [];
    });
    setQueueState("idle");
    setErrorMessage(null);
    setIsDragActive(false);
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (queuedAssets.length === 0 || isPending) {
        return;
      }

      const manifest = queuedAssets.map((draft, index) => ({
        label: draft.label.trim() || draft.file.name,
        altText: draft.altText.trim(),
        usageTags: draft.usageTags
          .split(/,|\n/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        displayOrder: index,
      }));

      const payload = new FormData();
      payload.set("productId", productId);
      payload.set("csrfToken", csrfToken);
      payload.set("manifest", JSON.stringify(manifest));
      queuedAssets.forEach((draft) => {
        payload.append("files", draft.file);
      });

      setQueueState("pending");
      setErrorMessage(null);

      startTransition(async () => {
        try {
          const result = await uploadProductAssetAction(payload);
          if (!result.success) {
            throw new Error(result.error ?? "Failed to upload assets.");
          }
          resetQueue();
          setQueueState("success");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          setQueueState("error");
          setErrorMessage(message);
        }
      });
    },
    [csrfToken, isPending, productId, queuedAssets, resetQueue]
  );

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const renderQueueMessage = () => {
    if (queueState === "success") {
      return "Assets queued and published.";
    }
    if (queueState === "error" && errorMessage) {
      return errorMessage;
    }
    if (queueState === "pending") {
      return "Uploading assets…";
    }
    if (queuedAssets.length > 0) {
      return `${queuedAssets.length} asset${queuedAssets.length === 1 ? "" : "s"} queued · ${formatBytes(totalBytes)}`;
    }
    return "Drag files here or browse to add product imagery.";
  };

  return (
    <form
      className="space-y-4 rounded-3xl border border-white/10 bg-black/40 p-5"
      onSubmit={handleSubmit}
      noValidate
    >
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={handleFilesFromInput} />

      <div
        className={[
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
          isDragActive ? "border-emerald-400/60 bg-emerald-500/5" : "border-white/15 bg-black/40",
          queuedAssets.length === 0 ? "text-white/60" : "text-white/80",
        ].join(" ")}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onClick={openFileDialog}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openFileDialog();
          }
        }}
        aria-label="Upload product assets"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-white/40">Upload assets</p>
        <p className="text-sm text-white/70">{renderQueueMessage()}</p>
        <span className="text-xs text-white/40">Max 50MB per file · Images or video formats</span>
      </div>

      {queuedAssets.length > 0 && (
        <div className="space-y-3">
          {queuedAssets.map((draft, index) => (
            <div
              key={draft.id}
              className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-black/60 p-4 md:flex-row md:items-start"
            >
              {draft.previewUrl ? (
                <Image
                  src={draft.previewUrl}
                  alt={draft.altText?.trim() || draft.file.name || "Asset preview"}
                  width={96}
                  height={96}
                  className="h-24 w-24 flex-none rounded-xl border border-white/10 object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-24 w-24 flex-none items-center justify-center rounded-xl border border-white/10 text-xs uppercase tracking-[0.3em] text-white/40">
                  {draft.file.type.startsWith("video/") ? "VIDEO" : "ASSET"}
                </div>
              )}
              <div className="flex-1 space-y-3 text-sm text-white/70">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                  <span className="rounded-full border border-white/20 px-2 py-0.5 uppercase tracking-[0.2em]">
                    {formatBytes(draft.file.size)}
                  </span>
                  <span className="rounded-full border border-white/20 px-2 py-0.5 uppercase tracking-[0.2em]">
                    {draft.file.type || "Unknown type"}
                  </span>
                  <span className="rounded-full border border-white/20 px-2 py-0.5 uppercase tracking-[0.2em]">
                    #{index + 1}
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Label</span>
                  <input
                    type="text"
                    value={draft.label}
                    onChange={(event) =>
                      updateDraft(draft.id, (current) => ({ ...current, label: event.target.value }))
                    }
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    placeholder={draft.file.name}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Alt text</span>
                  <input
                    type="text"
                    value={draft.altText}
                    onChange={(event) =>
                      updateDraft(draft.id, (current) => ({ ...current, altText: event.target.value }))
                    }
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    placeholder="Describe the asset for screen readers"
                    maxLength={180}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.3em] text-white/40">Usage tags</span>
                  <input
                    type="text"
                    value={draft.usageTags}
                    onChange={(event) =>
                      updateDraft(draft.id, (current) => ({ ...current, usageTags: event.target.value }))
                    }
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-white/40"
                    placeholder="e.g. hero, thumbnail, onboarding"
                  />
                </label>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                  onClick={() => reorderDraft(draft.id, "up")}
                  disabled={index === 0}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
                  onClick={() => reorderDraft(draft.id, "down")}
                  disabled={index === queuedAssets.length - 1}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="rounded-full border border-red-400/40 px-3 py-1 text-xs uppercase tracking-[0.3em] text-red-200 transition hover:border-red-300"
                  onClick={() => removeDraft(draft.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4 text-xs text-white/60 md:flex-row md:items-center md:justify-between">
        <div>
          {queueState === "error" && errorMessage && (
            <span className="text-red-300">Upload failed: {errorMessage}</span>
          )}
          {queueState === "success" && <span className="text-emerald-300">Assets uploaded.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            onClick={resetQueue}
            disabled={queuedAssets.length === 0 && queueState !== "success"}
          >
            Clear queue
          </button>
          <button
            type="submit"
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={queuedAssets.length === 0 || isPending}
          >
            {queueState === "pending" || isPending ? "Uploading…" : "Publish assets"}
          </button>
        </div>
      </div>
    </form>
  );
}
