"use client";

import useSWR, { type SWRResponse } from "swr";

import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

const GUARDRAIL_WORKFLOW_ENDPOINT = "/api/reporting/guardrail-workflow";

const jsonHeaders = {
  Accept: "application/json",
};

const buildGuardrailWorkflowSummaryUrl = (limit?: number): string => {
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return `${GUARDRAIL_WORKFLOW_ENDPOINT}?limit=${encodeURIComponent(String(limit))}`;
  }
  return GUARDRAIL_WORKFLOW_ENDPOINT;
};

const guardrailWorkflowSummaryFetcher = async (url: string): Promise<GuardrailWorkflowTelemetrySummary> => {
  const response = await fetch(url, {
    method: "GET",
    headers: jsonHeaders,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Unable to load guardrail workflow telemetry (${response.status})`);
  }
  return (await response.json()) as GuardrailWorkflowTelemetrySummary;
};

export async function fetchGuardrailWorkflowTelemetrySummaryFromApi(
  limit?: number,
): Promise<GuardrailWorkflowTelemetrySummary> {
  return guardrailWorkflowSummaryFetcher(buildGuardrailWorkflowSummaryUrl(limit));
}

type GuardrailWorkflowSummaryHookOptions = {
  limit?: number;
  refreshIntervalMs?: number;
  revalidateOnFocus?: boolean;
  revalidateOnMount?: boolean;
  fallbackData?: GuardrailWorkflowTelemetrySummary | null;
  pause?: boolean;
};

export function useGuardrailWorkflowTelemetrySummary(
  options: GuardrailWorkflowSummaryHookOptions = {},
): SWRResponse<GuardrailWorkflowTelemetrySummary, Error> {
  const {
    limit,
    refreshIntervalMs = 60_000,
    revalidateOnFocus = true,
    revalidateOnMount = true,
    fallbackData = null,
    pause = false,
  } = options;
  const key = pause ? null : buildGuardrailWorkflowSummaryUrl(limit);
  return useSWR<GuardrailWorkflowTelemetrySummary, Error>(key, guardrailWorkflowSummaryFetcher, {
    refreshInterval: refreshIntervalMs,
    revalidateOnFocus,
    revalidateOnReconnect: revalidateOnFocus,
    revalidateIfStale: revalidateOnMount,
    revalidateOnMount,
    fallbackData: fallbackData ?? undefined,
  });
}
