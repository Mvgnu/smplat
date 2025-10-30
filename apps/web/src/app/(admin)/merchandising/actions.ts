"use server";

import { promises as fs } from "fs";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import path from "path";

import { requireRole } from "@/server/auth/policies";
import { upsertCatalogBundle, deleteCatalogBundle } from "@/server/catalog/bundles";
import {
  attachProductAsset,
  replaceProductConfiguration,
  updateProductChannels,
  updateProductStatus,
  restoreProductFromAudit,
  type ProductConfigurationInput,
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
  await requireRole("operator", {
    context: {
      route: "admin.merchandising.updateChannels",
      method: "POST"
    }
  });
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
  await requireRole("operator", {
    context: {
      route: "admin.merchandising.updateStatus",
      method: "POST"
    }
  });
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
  await requireRole("operator", {
    context: {
      route: "admin.merchandising.uploadAsset",
      method: "POST"
    }
  });
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

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseNumber(value: unknown, fallback = 0): number {
  const coerced = typeof value === "string" && value.trim() !== "" ? Number(value) : Number(value);
  return Number.isFinite(coerced) ? coerced : fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function parseConfigurationPayload(raw: unknown): ProductConfigurationInput {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const optionGroupsRaw = Array.isArray(source.optionGroups) ? (source.optionGroups as unknown[]) : [];
  const optionGroups = optionGroupsRaw.map((entry, index) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const optionsRaw = Array.isArray(item.options) ? (item.options as unknown[]) : [];
    const options = optionsRaw.map((optionEntry, optionIndex) => {
      const option = optionEntry && typeof optionEntry === "object" ? (optionEntry as Record<string, unknown>) : {};
      return {
        id: typeof option.id === "string" && option.id.length > 0 ? option.id : null,
        name: typeof option.name === "string" ? option.name : `Option ${optionIndex + 1}`,
        description: typeof option.description === "string" ? option.description : null,
        priceDelta: parseNumber(option.priceDelta, 0),
        displayOrder: parseNumber(option.displayOrder, optionIndex),
        metadata: parseMetadata(option.metadata ?? option.metadataJson),
      };
    });

    const groupType = item.groupType === "multiple" ? "multiple" : "single";

    return {
      id: typeof item.id === "string" && item.id.length > 0 ? item.id : null,
      name: typeof item.name === "string" ? item.name : `Group ${index + 1}`,
      description: typeof item.description === "string" ? item.description : null,
      groupType,
      isRequired: parseBoolean(item.isRequired),
      displayOrder: parseNumber(item.displayOrder, index),
      metadata: parseMetadata(item.metadata ?? item.metadataJson),
      options,
    };
  });

  const addOnsRaw = Array.isArray(source.addOns) ? (source.addOns as unknown[]) : [];
  const addOns = addOnsRaw.map((entry, index) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof item.id === "string" && item.id.length > 0 ? item.id : null,
      label: typeof item.label === "string" ? item.label : `Add-on ${index + 1}`,
      description: typeof item.description === "string" ? item.description : null,
      priceDelta: parseNumber(item.priceDelta, 0),
      isRecommended: parseBoolean(item.isRecommended),
      displayOrder: parseNumber(item.displayOrder, index),
    };
  });

  const customFieldsRaw = Array.isArray(source.customFields) ? (source.customFields as unknown[]) : [];
  const allowedFieldTypes = new Set(["text", "url", "number"]);
  const customFields = customFieldsRaw.map((entry, index) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const fieldType = typeof item.fieldType === "string" && allowedFieldTypes.has(item.fieldType)
      ? (item.fieldType as "text" | "url" | "number")
      : "text";
    return {
      id: typeof item.id === "string" && item.id.length > 0 ? item.id : null,
      label: typeof item.label === "string" ? item.label : `Field ${index + 1}`,
      fieldType,
      placeholder: typeof item.placeholder === "string" ? item.placeholder : null,
      helpText: typeof item.helpText === "string" ? item.helpText : null,
      isRequired: parseBoolean(item.isRequired),
      displayOrder: parseNumber(item.displayOrder, index),
    };
  });

  const plansRaw = Array.isArray(source.subscriptionPlans) ? (source.subscriptionPlans as unknown[]) : [];
  const allowedBillingCycles = new Set(["one_time", "monthly", "quarterly", "annual"]);
  const subscriptionPlans = plansRaw.map((entry, index) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const billingCycle =
      typeof item.billingCycle === "string" && allowedBillingCycles.has(item.billingCycle)
        ? (item.billingCycle as "one_time" | "monthly" | "quarterly" | "annual")
        : "one_time";
    return {
      id: typeof item.id === "string" && item.id.length > 0 ? item.id : null,
      label: typeof item.label === "string" ? item.label : `Plan ${index + 1}`,
      description: typeof item.description === "string" ? item.description : null,
      billingCycle,
      priceMultiplier:
        item.priceMultiplier != null && Number.isFinite(Number(item.priceMultiplier))
          ? Number(item.priceMultiplier)
          : null,
      priceDelta:
        item.priceDelta != null && Number.isFinite(Number(item.priceDelta))
          ? Number(item.priceDelta)
          : null,
      isDefault: parseBoolean(item.isDefault),
      displayOrder: parseNumber(item.displayOrder, index),
    };
  });

  return { optionGroups, addOns, customFields, subscriptionPlans } satisfies ProductConfigurationInput;
}

async function updateProductConfigurationActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("admin", {
    context: {
      route: "admin.merchandising.updateConfiguration",
      method: "POST"
    }
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const productId = formData.get("productId");
  const configurationRaw = formData.get("configuration");

  if (typeof productId !== "string" || productId.length === 0) {
    return { success: false, error: "Missing product identifier." };
  }

  if (typeof configurationRaw !== "string" || configurationRaw.length === 0) {
    return { success: false, error: "Missing configuration payload." };
  }

  try {
    const parsedJson = JSON.parse(configurationRaw) as unknown;
    const configuration = parseConfigurationPayload(parsedJson);
    await replaceProductConfiguration(productId, configuration);
    revalidatePath("/admin/merchandising");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "Configuration payload is not valid JSON."
        : error instanceof Error
          ? error.message
          : "Failed to update configuration.";
    return { success: false, error: message };
  }
}

async function upsertBundleActionImpl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("admin", {
    context: {
      route: "admin.merchandising.upsertBundle",
      method: "POST"
    }
  });
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
  await requireRole("admin", {
    context: {
      route: "admin.merchandising.deleteBundle",
      method: "POST"
    }
  });
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
  await requireRole("admin", {
    context: {
      route: "admin.merchandising.restoreProduct",
      method: "POST"
    }
  });
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

export const updateProductConfigurationAction = serverTelemetry.wrapServerAction(
  "admin.merchandising.updateConfiguration",
  updateProductConfigurationActionImpl,
  { "server.action.feature": "merchandising", "server.action.operation": "update_configuration" }
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
