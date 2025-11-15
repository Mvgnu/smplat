"use server";

import "server-only";

import type {
  JourneyComponentRun,
  JourneyComponentRunRequest,
  ProductJourneyRuntime,
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const runtimeApiKey = process.env.CHECKOUT_API_KEY ?? "";

function buildRuntimeHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (runtimeApiKey) {
    headers.set("X-API-Key", runtimeApiKey);
  }
  return headers;
}

export async function triggerJourneyComponentRun(
  payload: JourneyComponentRunRequest,
): Promise<JourneyComponentRun> {
  const response = await fetch(`${apiBaseUrl}/api/v1/journey-components/run`, {
    method: "POST",
    headers: buildRuntimeHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail && detail.length < 240
        ? `Journey runtime request failed (${response.status}): ${detail}`
        : `Journey runtime request failed (${response.status}).`,
    );
  }

  return (await response.json()) as JourneyComponentRun;
}

export async function fetchProductJourneyRuntime(
  productId: string,
): Promise<ProductJourneyRuntime | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/journeys`, {
      method: "GET",
      headers: buildRuntimeHeaders(),
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ProductJourneyRuntime;
  } catch (error) {
    console.warn("Failed to fetch product journey runtime", { productId, error });
    return null;
  }
}

export type TriggeredJourneySummary = {
  componentId: string;
  productComponentId?: string | null;
  status: JourneyComponentRun["status"];
  runId: string;
};
