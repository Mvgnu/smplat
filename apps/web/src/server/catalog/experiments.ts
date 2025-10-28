import "server-only";

import {
  type CatalogExperimentGuardrailEvaluation,
  type CatalogExperimentGuardrailEvaluationApi,
  type CatalogExperimentResponse,
  type CatalogExperimentResponseApi,
  normalizeCatalogExperiment,
  normalizeCatalogExperimentGuardrails,
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey =
  process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY ?? "";

export type CreateExperimentPayload = {
  slug: string;
  name: string;
  description?: string | null;
  guardrailConfig?: Record<string, unknown>;
  sampleSizeGuardrail?: number;
  variants: Array<{
    key: string;
    name: string;
    weight?: number;
    isControl?: boolean;
    bundleSlug?: string | null;
    overridePayload?: Record<string, unknown>;
  }>;
};

export type UpdateExperimentPayload = {
  status?: string;
  guardrailConfig?: Record<string, unknown>;
  sampleSizeGuardrail?: number;
};

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (!checkoutApiKey) {
    throw new Error("Missing checkout API key for experiment calls");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": checkoutApiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request to ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchCatalogExperiments(): Promise<CatalogExperimentResponse[]> {
  if (!checkoutApiKey) {
    return [];
  }

  const payload = await requestApi<CatalogExperimentResponseApi[]>("/api/v1/catalog/experiments");
  return payload.map((entry) => normalizeCatalogExperiment(entry));
}

export async function createCatalogExperiment(
  payload: CreateExperimentPayload,
): Promise<CatalogExperimentResponse> {
  const apiPayload = {
    slug: payload.slug,
    name: payload.name,
    description: payload.description ?? null,
    guardrail_config: payload.guardrailConfig ?? {},
    sample_size_guardrail: payload.sampleSizeGuardrail ?? 0,
    variants: payload.variants.map((variant) => ({
      key: variant.key,
      name: variant.name,
      weight: variant.weight ?? 0,
      is_control: variant.isControl ?? false,
      bundle_slug: variant.bundleSlug ?? null,
      override_payload: variant.overridePayload ?? {},
    })),
  } satisfies Record<string, unknown>;

  const response = await requestApi<CatalogExperimentResponseApi>("/api/v1/catalog/experiments", {
    method: "POST",
    body: JSON.stringify(apiPayload),
  });

  return normalizeCatalogExperiment(response);
}

export async function updateCatalogExperiment(
  slug: string,
  payload: UpdateExperimentPayload,
): Promise<CatalogExperimentResponse> {
  const apiPayload = {
    status: payload.status,
    guardrail_config: payload.guardrailConfig,
    sample_size_guardrail: payload.sampleSizeGuardrail,
  } satisfies Record<string, unknown>;

  const response = await requestApi<CatalogExperimentResponseApi>(
    `/api/v1/catalog/experiments/${slug}`,
    {
      method: "PUT",
      body: JSON.stringify(apiPayload),
    },
  );

  return normalizeCatalogExperiment(response);
}

export async function publishCatalogExperiment(
  slug: string,
): Promise<CatalogExperimentResponse> {
  const response = await requestApi<CatalogExperimentResponseApi>(
    `/api/v1/catalog/experiments/${slug}/publish`,
    {
      method: "POST",
    },
  );
  return normalizeCatalogExperiment(response);
}

export async function evaluateExperimentGuardrails(
  slug: string,
): Promise<CatalogExperimentGuardrailEvaluation> {
  const response = await requestApi<CatalogExperimentGuardrailEvaluationApi>(
    `/api/v1/catalog/experiments/${slug}/evaluate`,
    {
      method: "POST",
    },
  );
  return normalizeCatalogExperimentGuardrails(response);
}
