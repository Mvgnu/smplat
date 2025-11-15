"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/server/auth/policies";
import {
  createFulfillmentProvider,
  createFulfillmentService,
  deleteFulfillmentProvider,
  deleteFulfillmentService,
  refreshProviderBalance,
  triggerProviderOrderRefill,
  triggerProviderOrderReplay,
  updateFulfillmentProvider,
  updateFulfillmentService,
} from "@/server/fulfillment/providers";
import { ensureCsrfToken } from "@/server/security/csrf";

export type ActionState = {
  success: boolean;
  error?: string;
};

export const initialActionState: ActionState = { success: false };

type EndpointKey = "order" | "balance" | "refill";
type EndpointConfigs = Partial<Record<EndpointKey, Record<string, unknown> | null>>;

const ENDPOINT_FIELD_MAP: Record<EndpointKey, string> = {
  order: "orderEndpoint",
  balance: "balanceEndpoint",
  refill: "refillEndpoint",
};

function parseStringList(value: FormDataEntryValue | null): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/[,\\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | null | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Value must be a non-negative number.");
  }
  return numeric;
}

function parseOptionalJson(value: FormDataEntryValue | null, field: string): Record<string, unknown> | null | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`${field} must be a JSON object.`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Failed to parse ${field}. Ensure it is valid JSON.`;
    throw new Error(message);
  }
}

function parseOptionalIsoTimestamp(value: FormDataEntryValue | null): string | undefined | null {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Health timestamp must be a valid ISO-8601 date.");
  }
  return date.toISOString();
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseOptionalDateTimeLocal(value: FormDataEntryValue | null): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Schedule time must be a valid date/time.");
  }
  return parsed.toISOString();
}

function parseEndpointConfigs(formData: FormData): EndpointConfigs {
  const configs: EndpointConfigs = {};
  (Object.keys(ENDPOINT_FIELD_MAP) as EndpointKey[]).forEach((key) => {
    const formField = ENDPOINT_FIELD_MAP[key];
    const parsed = parseOptionalJson(formData.get(formField), formField);
    if (parsed !== undefined) {
      configs[key] = parsed;
    }
  });
  return configs;
}

function mergeEndpointMetadata(
  metadataInput: Record<string, unknown> | null | undefined,
  configs: EndpointConfigs,
): Record<string, unknown> {
  const metadata = metadataInput && isPlainObject(metadataInput) ? { ...metadataInput } : {};
  const automationRaw = metadata.automation;
  const automation = automationRaw && isPlainObject(automationRaw) ? { ...automationRaw } : {};
  const endpointsRaw = (automation as Record<string, unknown>).endpoints;
  const endpoints = endpointsRaw && isPlainObject(endpointsRaw) ? { ...endpointsRaw } : {};

  let changed = false;
  (Object.keys(configs) as EndpointKey[]).forEach((key) => {
    const config = configs[key];
    if (config === undefined) {
      return;
    }
    changed = true;
    if (config === null) {
      delete endpoints[key];
    } else {
      endpoints[key] = config;
    }
  });

  if (changed) {
    if (Object.keys(endpoints).length > 0) {
      automation.endpoints = endpoints;
    } else {
      delete automation.endpoints;
    }
    if (Object.keys(automation).length > 0) {
      metadata.automation = automation;
    } else {
      delete metadata.automation;
    }
  }

  return metadata;
}

function buildUpdatePayload(formData: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

export async function createProviderAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.create", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const id = formData.get("providerId");
  const name = formData.get("name");
  if (typeof id !== "string" || id.trim().length === 0) {
    return { success: false, error: "Provider ID is required." };
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return { success: false, error: "Provider name is required." };
  }

  try {
    const allowedRegions = parseStringList(formData.get("allowedRegions"));
    const rateLimitPerMinute = parseOptionalNumber(formData.get("rateLimit"));
    const metadataInput = parseOptionalJson(formData.get("metadata"), "metadata");
    const credentials = parseOptionalJson(formData.get("credentials"), "credentials");
    const healthPayload = parseOptionalJson(formData.get("healthPayload"), "healthPayload");
    const lastHealthCheckAt = parseOptionalIsoTimestamp(formData.get("lastHealthCheckAt"));
    const endpointConfigs = parseEndpointConfigs(formData);
    const hasEndpointConfig = Object.values(endpointConfigs).some((value) => value !== undefined);
    const metadata = mergeEndpointMetadata(metadataInput ?? {}, endpointConfigs);

    const payload: Record<string, unknown> = {
      id: id.trim(),
      name: name.trim(),
      description: typeof formData.get("description") === "string" ? formData.get("description") : null,
      base_url: typeof formData.get("baseUrl") === "string" ? formData.get("baseUrl") : null,
      status: typeof formData.get("status") === "string" ? formData.get("status") : "active",
      health_status:
        typeof formData.get("healthStatus") === "string" && formData.get("healthStatus")
          ? formData.get("healthStatus")
          : undefined,
    };

    if (allowedRegions !== undefined) {
      payload.allowed_regions = allowedRegions;
    }
    if (rateLimitPerMinute !== undefined) {
      payload.rate_limit_per_minute = rateLimitPerMinute;
    }
    if (metadataInput !== undefined || hasEndpointConfig) {
      payload.metadata = metadata;
    }
    if (credentials !== undefined) {
      payload.credentials = credentials;
    }
    if (healthPayload !== undefined) {
      payload.health_payload = healthPayload;
    }
    if (lastHealthCheckAt !== undefined) {
      payload.last_health_check_at = lastHealthCheckAt;
    }

    await createFulfillmentProvider(payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create provider.",
    };
  }
}

export async function updateProviderAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.update", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }

  try {
    const allowedRegions = parseStringList(formData.get("allowedRegions"));
    const rateLimitPerMinute = parseOptionalNumber(formData.get("rateLimit"));
    const metadataInput = parseOptionalJson(formData.get("metadata"), "metadata");
    const credentials = parseOptionalJson(formData.get("credentials"), "credentials");
    const healthPayload = parseOptionalJson(formData.get("healthPayload"), "healthPayload");
    const lastHealthCheckAt = parseOptionalIsoTimestamp(formData.get("lastHealthCheckAt"));
    const endpointConfigs = parseEndpointConfigs(formData);
    const hasEndpointConfig = Object.values(endpointConfigs).some((value) => value !== undefined);
    const metadata = metadataInput !== undefined || hasEndpointConfig ? mergeEndpointMetadata(metadataInput ?? {}, endpointConfigs) : undefined;

    const payload: Record<string, unknown> = {};
    const basePayload = buildUpdatePayload(formData);

    if (typeof basePayload.name === "string") {
      payload.name = basePayload.name.trim();
    }
    if (typeof basePayload.description === "string") {
      payload.description = basePayload.description;
    }
    if (typeof basePayload.baseUrl === "string") {
      payload.base_url = basePayload.baseUrl;
    }
    if (typeof basePayload.status === "string" && basePayload.status) {
      payload.status = basePayload.status;
    }
    if (typeof basePayload.healthStatus === "string" && basePayload.healthStatus) {
      payload.health_status = basePayload.healthStatus;
    }

    if (allowedRegions !== undefined) {
      payload.allowed_regions = allowedRegions;
    }
    if (rateLimitPerMinute !== undefined) {
      payload.rate_limit_per_minute = rateLimitPerMinute;
    }
    if (metadata !== undefined) {
      payload.metadata = metadata;
    }
    if (credentials !== undefined) {
      payload.credentials = credentials;
    }
    if (healthPayload !== undefined) {
      payload.health_payload = healthPayload;
    }
    if (lastHealthCheckAt !== undefined) {
      payload.last_health_check_at = lastHealthCheckAt;
    }

    if (Object.keys(payload).length === 0) {
      return { success: false, error: "No changes provided." };
    }

    await updateFulfillmentProvider(providerId, payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update provider.",
    };
  }
}

export async function deleteProviderAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.delete", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }

  try {
    await deleteFulfillmentProvider(providerId);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete provider.",
    };
  }
}

export async function createServiceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.services.create", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  const serviceId = formData.get("serviceId");
  const name = formData.get("name");
  const action = formData.get("action");

  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }
  if (typeof serviceId !== "string" || serviceId.trim().length === 0) {
    return { success: false, error: "Service ID is required." };
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return { success: false, error: "Service name is required." };
  }
  if (typeof action !== "string" || action.trim().length === 0) {
    return { success: false, error: "Service action is required." };
  }

  try {
    const allowedRegions = parseStringList(formData.get("allowedRegions"));
    const rateLimitPerMinute = parseOptionalNumber(formData.get("rateLimit"));
    const metadata = parseOptionalJson(formData.get("metadata"), "metadata");
    const credentials = parseOptionalJson(formData.get("credentials"), "credentials");
    const healthPayload = parseOptionalJson(formData.get("healthPayload"), "healthPayload");
    const lastHealthCheckAt = parseOptionalIsoTimestamp(formData.get("lastHealthCheckAt"));

    const payload: Record<string, unknown> = {
      id: serviceId.trim(),
      name: name.trim(),
      action: action.trim(),
      category: typeof formData.get("category") === "string" ? formData.get("category") : null,
      default_currency:
        typeof formData.get("defaultCurrency") === "string" ? formData.get("defaultCurrency") : null,
      status: typeof formData.get("status") === "string" ? formData.get("status") : "active",
      health_status:
        typeof formData.get("healthStatus") === "string" && formData.get("healthStatus")
          ? formData.get("healthStatus")
          : undefined,
    };

    if (allowedRegions !== undefined) {
      payload.allowed_regions = allowedRegions;
    }
    if (rateLimitPerMinute !== undefined) {
      payload.rate_limit_per_minute = rateLimitPerMinute;
    }
    if (metadata !== undefined) {
      payload.metadata = metadata;
    }
    if (credentials !== undefined) {
      payload.credentials = credentials;
    }
    if (healthPayload !== undefined) {
      payload.health_payload = healthPayload;
    }
    if (lastHealthCheckAt !== undefined) {
      payload.last_health_check_at = lastHealthCheckAt;
    }

    await createFulfillmentService(providerId, payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create service.",
    };
  }
}

export async function updateServiceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.services.update", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  const serviceId = formData.get("serviceId");
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }
  if (typeof serviceId !== "string" || serviceId.trim().length === 0) {
    return { success: false, error: "Service identifier missing." };
  }

  try {
    const allowedRegions = parseStringList(formData.get("allowedRegions"));
    const rateLimitPerMinute = parseOptionalNumber(formData.get("rateLimit"));
    const metadata = parseOptionalJson(formData.get("metadata"), "metadata");
    const credentials = parseOptionalJson(formData.get("credentials"), "credentials");
    const healthPayload = parseOptionalJson(formData.get("healthPayload"), "healthPayload");
    const lastHealthCheckAt = parseOptionalIsoTimestamp(formData.get("lastHealthCheckAt"));

    const payload: Record<string, unknown> = {};
    const basePayload = buildUpdatePayload(formData);

    if (typeof basePayload.name === "string") {
      payload.name = basePayload.name.trim();
    }
    if (typeof basePayload.action === "string") {
      payload.action = basePayload.action.trim();
    }
    if (typeof basePayload.category === "string") {
      payload.category = basePayload.category;
    }
    if (typeof basePayload.defaultCurrency === "string") {
      payload.default_currency = basePayload.defaultCurrency;
    }
    if (typeof basePayload.status === "string" && basePayload.status) {
      payload.status = basePayload.status;
    }
    if (typeof basePayload.healthStatus === "string" && basePayload.healthStatus) {
      payload.health_status = basePayload.healthStatus;
    }

    if (allowedRegions !== undefined) {
      payload.allowed_regions = allowedRegions;
    }
    if (rateLimitPerMinute !== undefined) {
      payload.rate_limit_per_minute = rateLimitPerMinute;
    }
    if (metadata !== undefined) {
      payload.metadata = metadata;
    }
    if (credentials !== undefined) {
      payload.credentials = credentials;
    }
    if (healthPayload !== undefined) {
      payload.health_payload = healthPayload;
    }
    if (lastHealthCheckAt !== undefined) {
      payload.last_health_check_at = lastHealthCheckAt;
    }

    if (Object.keys(payload).length === 0) {
      return { success: false, error: "No changes provided." };
    }

    await updateFulfillmentService(providerId, serviceId, payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update service.",
    };
  }
}

export async function deleteServiceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.services.delete", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  const serviceId = formData.get("serviceId");
  if (typeof providerId !== "string" || typeof serviceId !== "string" || !providerId || !serviceId) {
    return { success: false, error: "Provider or service identifier missing." };
  }

  try {
    await deleteFulfillmentService(providerId, serviceId);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete service.",
    };
  }
}

export async function refreshProviderBalanceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.balance.refresh", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }

  try {
    await refreshProviderBalance(providerId);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to refresh balance.",
    };
  }
}

export async function triggerProviderRefillAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.orders.refill", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  const providerOrderId = formData.get("providerOrderId");
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }
  if (typeof providerOrderId !== "string" || providerOrderId.trim().length === 0) {
    return { success: false, error: "Provider order identifier missing." };
  }

  try {
    const amount = parseOptionalNumber(formData.get("amount"));
    const payload: { amount?: number | null } = {};
    if (amount !== undefined) {
      payload.amount = amount;
    }
    await triggerProviderOrderRefill(providerId, providerOrderId, payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to trigger refill.",
    };
  }
}

export async function replayProviderOrderAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("operator", {
    context: { route: "admin.fulfillment.providers.orders.replay", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: String(formData.get("csrfToken") ?? "") });

  const providerId = formData.get("providerId");
  const providerOrderId = formData.get("providerOrderId");
  const mode = typeof formData.get("mode") === "string" ? String(formData.get("mode")) : "execute";
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { success: false, error: "Provider identifier missing." };
  }
  if (typeof providerOrderId !== "string" || providerOrderId.trim().length === 0) {
    return { success: false, error: "Provider order identifier missing." };
  }

  try {
    const amount = parseOptionalNumber(formData.get("amount"));
    const runAt = parseOptionalDateTimeLocal(formData.get("runAt"));
    if (mode === "schedule" && !runAt) {
      return { success: false, error: "Select a schedule time for the replay." };
    }

    const payload: { amount?: number | null; runAt?: string; scheduleOnly?: boolean } = {};
    if (amount !== undefined) {
      payload.amount = amount;
    }
    if (runAt) {
      payload.runAt = runAt;
    }
    if (mode === "schedule") {
      payload.scheduleOnly = true;
    }

    await triggerProviderOrderReplay(providerId, providerOrderId, payload);
    revalidatePath("/admin/fulfillment/providers");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to replay provider order.",
    };
  }
}
