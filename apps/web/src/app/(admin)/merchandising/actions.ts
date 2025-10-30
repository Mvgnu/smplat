"use server";

import { promises as fs } from "fs";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import path from "path";

import { requireRole } from "@/server/auth/policies";
import { upsertCatalogBundle, deleteCatalogBundle } from "@/server/catalog/bundles";
import {
  attachProductAsset,
  updateProductChannels,
  updateProductStatus,
  restoreProductFromAudit,
} from "@/server/catalog/products";
import { ensureCsrfToken } from "@/server/security/csrf";
import { serverTelemetry } from "@/server/observability/tracing";

export type ActionState = {
  success: boolean;
  error?: string;
};

const defaultState: ActionState = { success: false };

export { defaultState as initialActionState };

const UPLOAD_DIR = path.join(process.cwd(), "apps/web/public/uploads");

async function persistUploadedFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const filename = `${randomUUID()}.${extension}`;
  const targetPath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(targetPath, buffer);
  return `/uploads/${filename}`;
}

function extractFormChannels(formData: FormData): string[] {
  const entries = formData.getAll("channels");
  const normalized = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return Array.from(normalized);
}

async function updateProductChannelsActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const productId = formData.get("productId");
  if (typeof productId !== "string") {
    return { success: false, error: "Missing product identifier." };
  }

  try {
    await updateProductChannels(productId, extractFormChannels(formData));
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update product channels.",
    };
  }
}

async function updateProductStatusActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const productId = formData.get("productId");
  const status = formData.get("status");

  if (typeof productId !== "string" || typeof status !== "string") {
    return { success: false, error: "Missing product or status." };
  }

  if (![`draft`, `active`, `archived`].includes(status)) {
    return { success: false, error: "Unsupported product status." };
  }

  try {
    await updateProductStatus(productId, status as "draft" | "active" | "archived");
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update product status.",
    };
  }
}

async function uploadProductAssetActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const productId = formData.get("productId");
  const file = formData.get("assetFile");
  const label = formData.get("label");

  if (typeof productId !== "string" || !(file instanceof File) || file.size === 0) {
    return { success: false, error: "Upload requires a product and a file." };
  }

  try {
    const assetUrl = await persistUploadedFile(file);
    await attachProductAsset(productId, assetUrl, typeof label === "string" ? label : undefined);
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload asset.",
    };
  }
}

async function upsertBundleActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("admin");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const id = formData.get("bundleId");
  const primaryProductSlug = formData.get("primaryProductSlug");
  const bundleSlug = formData.get("bundleSlug");
  const title = formData.get("title");
  const description = formData.get("description");
  const savingsCopy = formData.get("savingsCopy");
  const cmsPriority = Number(formData.get("cmsPriority") ?? 100);
  const componentsInput = formData.get("components");
  const componentSlugs =
    typeof componentsInput === "string"
      ? componentsInput
          .split(/\r?\n|,/) // split by newline or comma
          .map((value) => value.trim())
          .filter(Boolean)
      : formData
          .getAll("componentSlugs")
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean);

  if (typeof primaryProductSlug !== "string" || typeof bundleSlug !== "string" || typeof title !== "string") {
    return { success: false, error: "Bundle slug, title, and primary product are required." };
  }

  const components = componentSlugs.map((slug) => ({ slug }));

  try {
    await upsertCatalogBundle({
      id: typeof id === "string" && id ? id : undefined,
      primaryProductSlug,
      bundleSlug,
      title,
      description: typeof description === "string" ? description : null,
      savingsCopy: typeof savingsCopy === "string" ? savingsCopy : null,
      cmsPriority: Number.isFinite(cmsPriority) ? cmsPriority : 100,
      components,
      metadata: {},
    });
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save catalog bundle.",
    };
  }
}

async function deleteBundleActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("admin");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const bundleId = formData.get("bundleId");
  if (typeof bundleId !== "string") {
    return { success: false, error: "Missing bundle identifier." };
  }

  try {
    await deleteCatalogBundle(bundleId);
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete catalog bundle.",
    };
  }
}

async function restoreProductFromAuditActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("admin");
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const logId = formData.get("logId");
  if (typeof logId !== "string") {
    return { success: false, error: "Missing audit entry identifier." };
  }

  try {
    await restoreProductFromAudit(logId);
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to restore product state.",
    };
  }
}

export const updateProductChannelsAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.updateChannels",
  updateProductChannelsActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "update_channels" }
);

export const updateProductStatusAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.updateStatus",
  updateProductStatusActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "update_status" }
);

export const uploadProductAssetAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.uploadAsset",
  uploadProductAssetActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "upload_asset" }
);

export const upsertBundleAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.upsertBundle",
  upsertBundleActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "upsert_bundle" }
);

export const deleteBundleAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.deleteBundle",
  deleteBundleActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "delete_bundle" }
);

export const restoreProductFromAuditAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.restoreProduct",
  restoreProductFromAuditActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "restore_product" }
);
