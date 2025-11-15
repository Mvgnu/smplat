import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { ProviderAutomationStatus, ProviderAutomationHistory, ProviderAutomationRunStatus } from "@/types/provider-automation";
import { apiBaseUrl, defaultHeaders, extractError } from "./providers";

export type ProviderAutomationSnapshot = {
  aggregated: ProviderAutomationTelemetry;
  providers: Array<{
    id: string;
    name: string;
    telemetry: ProviderAutomationTelemetry;
  }>;
};

export async function fetchProviderAutomationSnapshot(limitPerProvider = 25): Promise<ProviderAutomationSnapshot> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/automation/snapshot?limitPerProvider=${encodeURIComponent(
      String(limitPerProvider),
    )}`,
    {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  const payload = (await response.json()) as ProviderAutomationSnapshot;
  return payload;
}

export async function fetchProviderAutomationStatus(): Promise<ProviderAutomationStatus> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/automation/status`, {
    method: "GET",
    headers: defaultHeaders,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  return (await response.json()) as ProviderAutomationStatus;
}

export async function triggerProviderAutomationReplayRun(limit?: number): Promise<ProviderAutomationRunStatus> {
  const url = new URL(`${apiBaseUrl}/api/v1/fulfillment/providers/automation/replay/run`);
  if (typeof limit === "number") {
    url.searchParams.set("limit", String(limit));
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: defaultHeaders,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  return (await response.json()) as ProviderAutomationRunStatus;
}

export async function triggerProviderAutomationAlertRun(): Promise<ProviderAutomationRunStatus> {
  const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/automation/alerts/run`, {
    method: "POST",
    headers: defaultHeaders,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  return (await response.json()) as ProviderAutomationRunStatus;
}

export async function fetchProviderAutomationHistory(limit = 10): Promise<ProviderAutomationHistory> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/fulfillment/providers/automation/status/history?limit=${encodeURIComponent(
      String(limit),
    )}`,
    {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(await extractError(response));
  }
  return (await response.json()) as ProviderAutomationHistory;
}
