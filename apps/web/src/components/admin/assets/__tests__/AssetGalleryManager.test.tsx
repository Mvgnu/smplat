import { applyDraftNormalization, updateUsageDraft, type AssetDraft } from "../types";

const makeDraft = (overrides: Partial<AssetDraft> = {}): AssetDraft => {
  const file =
    overrides.file ??
    new File(["test"], overrides.label ?? "asset.png", { type: "image/png" });
  return {
    clientId: overrides.clientId ?? crypto.randomUUID(),
    file,
    label: overrides.label ?? "Asset",
    altText: overrides.altText ?? "",
    usageDraft: overrides.usageDraft ?? "",
    usageTags: overrides.usageTags ?? [],
    displayOrder: overrides.displayOrder ?? 0,
    isPrimary: overrides.isPrimary ?? false,
    previewUrl: overrides.previewUrl ?? null,
  };
};

describe("AssetGalleryManager helpers", () => {
  beforeAll(() => {
    if (!global.crypto?.randomUUID) {
      // @ts-expect-error - minimal shim for tests
      global.crypto = {
        randomUUID: () => "test-id",
      };
    }
  });

  it("normalizes display order and enforces a single primary asset", () => {
    const drafts: AssetDraft[] = [
      makeDraft({ clientId: "alpha", displayOrder: 5, isPrimary: true }),
      makeDraft({ clientId: "beta", displayOrder: 0, isPrimary: true }),
      makeDraft({ clientId: "gamma", displayOrder: 2, isPrimary: false }),
    ];

    const normalized = applyDraftNormalization(drafts);

    expect(normalized.map((draft) => draft.displayOrder)).toEqual([0, 1, 2]);
    expect(normalized.find((draft) => draft.clientId === "alpha")?.isPrimary).toBe(true);
    expect(normalized.find((draft) => draft.clientId === "beta")?.isPrimary).toBe(false);
    expect(normalized.filter((draft) => draft.isPrimary)).toHaveLength(1);
  });

  it("promotes the first asset to primary when none selected", () => {
    const drafts: AssetDraft[] = [
      makeDraft({ clientId: "hero" }),
      makeDraft({ clientId: "detail" }),
    ];

    const normalized = applyDraftNormalization(drafts);

    expect(normalized[0].isPrimary).toBe(true);
    expect(normalized[1].isPrimary).toBe(false);
  });

  it("updates usage tags when editing the draft textarea", () => {
    const draft = makeDraft({ clientId: "usage", usageDraft: "", usageTags: [] });

    const updated = updateUsageDraft(
      draft,
      "hero, detail\nsocial-proof\n , ",
    );

    expect(updated.usageDraft).toEqual("hero, detail\nsocial-proof\n , ");
    expect(updated.usageTags).toEqual(["hero", "detail", "social-proof"]);
  });
});
