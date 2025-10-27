import "server-only";

import { readFile } from "node:fs/promises";

import {
  ReconciliationDashboard,
  ReconciliationDiscrepancy,
  ReconciliationRun,
  ReconciliationStagingEntry,
} from "./types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

const emptyDashboard: ReconciliationDashboard = {
  runs: [],
  discrepancies: [],
  staging: [],
  stagingBacklog: 0,
};

type RunListingResponse = {
  runs: ReconciliationRun[];
  openDiscrepancies: ReconciliationDiscrepancy[];
  stagingBacklog: number;
};

export async function fetchReconciliationDashboard(): Promise<ReconciliationDashboard> {
  const mockPath = process.env.MOCK_RECONCILIATION_DASHBOARD_PATH;
  if (mockPath) {
    try {
      const file = await readFile(mockPath, "utf-8");
      const payload = JSON.parse(file) as ReconciliationDashboard;
      return payload;
    } catch (error) {
      console.warn("Failed to load reconciliation dashboard mock", error);
    }
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; reconciliation dashboard disabled.");
    return emptyDashboard;
  }

  try {
    const [runListing, discrepancies, staging] = await Promise.all([
      fetchRuns(),
      fetchDiscrepancies(),
      fetchStagingEntries(),
    ]);

    if (!runListing || !discrepancies || !staging) {
      return emptyDashboard;
    }

    const normalizedRuns = runListing.runs ?? [];
    const normalizedDiscrepancies = discrepancies ?? [];
    const normalizedStaging = staging ?? [];

    return {
      runs: normalizedRuns,
      discrepancies: normalizedDiscrepancies,
      staging: normalizedStaging,
      stagingBacklog: runListing.stagingBacklog ?? 0,
    };
  } catch (error) {
    console.warn("Failed to fetch reconciliation dashboard", error);
    return emptyDashboard;
  }
}

async function fetchRuns(): Promise<RunListingResponse | null> {
  return fetchJson<RunListingResponse>("/api/v1/billing/reconciliation/runs");
}

async function fetchDiscrepancies(): Promise<ReconciliationDiscrepancy[] | null> {
  return fetchJson<ReconciliationDiscrepancy[]>("/api/v1/billing/reconciliation/discrepancies");
}

async function fetchStagingEntries(): Promise<ReconciliationStagingEntry[] | null> {
  return fetchJson<ReconciliationStagingEntry[]>("/api/v1/billing/reconciliation/staging");
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "X-API-Key": checkoutApiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    console.warn(`Failed to fetch ${path}`, response.status);
    return null;
  }

  return (await response.json()) as T;
}
