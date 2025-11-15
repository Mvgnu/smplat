"use client";
export type AssetDraft = {
  clientId: string;
  file: File;
  label: string;
  altText: string;
  usageDraft: string;
  usageTags: string[];
  displayOrder: number;
  isPrimary: boolean;
  previewUrl: string | null;
};

const generateClientId = () => {
  try {
    if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // ignore – fall back to manual id below
  }
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const parseUsageTags = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

export const createAssetDraft = (
  file: File,
  displayOrder: number,
  options?: { promoteToPrimary?: boolean },
): AssetDraft => {
  const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  const promoteToPrimary = options?.promoteToPrimary ?? false;
  return {
    clientId: generateClientId(),
    file,
    label: file.name.replace(/\.[^.]+$/, ""),
    altText: "",
    usageDraft: "",
    usageTags: [],
    displayOrder,
    isPrimary: promoteToPrimary,
    previewUrl,
  };
};

export const applyDraftNormalization = (drafts: AssetDraft[]): AssetDraft[] => {
  let primarySeen = false;
  const hasPrimary = drafts.some((draft) => draft.isPrimary);
  return drafts.map((draft, index) => {
    let isPrimary = draft.isPrimary;
    if (hasPrimary) {
      if (isPrimary && primarySeen) {
        isPrimary = false;
      } else if (isPrimary) {
        primarySeen = true;
      }
    } else if (index === 0) {
      isPrimary = true;
      primarySeen = true;
    } else {
      isPrimary = false;
    }
    return {
      ...draft,
      displayOrder: index,
      isPrimary,
    };
  });
};

export const updateUsageDraft = (draft: AssetDraft, value: string): AssetDraft => ({
  ...draft,
  usageDraft: value,
  usageTags: parseUsageTags(value),
});
