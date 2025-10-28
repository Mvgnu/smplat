import "server-only";

import { readFile } from "node:fs/promises";

import {
  ProcessorReplayAttempt,
  ProcessorReplayDetail,
  ProcessorReplayEvent,
  ProcessorReplayFilters,
  ProcessorReplayStatus,
} from "./types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

type RawProcessorReplayEvent = {
  id: string;
  provider: string;
  externalId: string;
  correlationId: string | null;
  workspaceId: string | null;
  invoiceId: string | null;
  replayRequested: boolean;
  replayRequestedAt: string | null;
  replayAttempts: number;
  replayedAt: string | null;
  lastReplayError: string | null;
  receivedAt: string;
  createdAt: string;
};

type RawProcessorReplayAttempt = {
  id: string;
  attemptedAt: string;
  status: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

type RawProcessorReplayDetail = RawProcessorReplayEvent & {
  attempts: RawProcessorReplayAttempt[];
  invoiceSnapshot: ProcessorReplayDetail["invoiceSnapshot"];
};

type FetchReplayOptions = ProcessorReplayFilters & {
  requestedOnly?: boolean;
};

export type TriggerReplayOptions = {
  force?: boolean;
};

const emptyList: ProcessorReplayEvent[] = [];

export async function fetchProcessorReplays(
  filters: FetchReplayOptions = {},
): Promise<ProcessorReplayEvent[]> {
  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; replay dashboard disabled.");
    return emptyList;
  }

  const mockPath = process.env.MOCK_PROCESSOR_REPLAYS_PATH;
  if (mockPath) {
    try {
      const file = await readFile(mockPath, "utf-8");
      const payload = JSON.parse(file) as RawProcessorReplayEvent[];
      const normalized = payload.map((event) => normalizeReplayEvent(event));
      return applyClientSideFilters(normalized, filters);
    } catch (error) {
      console.warn("Failed to load processor replay mock", error);
    }
  }

  const params = new URLSearchParams();
  const limit = filters.limit ?? 100;
  params.set("limit", String(limit));

  if (filters.provider && filters.provider !== "all") {
    params.set("provider", filters.provider);
  }

  if (filters.requestedOnly !== undefined) {
    params.set("requestedOnly", String(filters.requestedOnly));
  } else if (filters.status && filters.status !== "pending") {
    params.set("requestedOnly", "false");
  }

  if (filters.workspaceId && filters.workspaceId !== "all") {
    params.set("workspaceId", filters.workspaceId);
  }

  if (filters.since) {
    params.set("since", filters.since);
  }

  const upstreamUrl = `${apiBaseUrl}/api/v1/billing/replays?${params.toString()}`;

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        "X-API-Key": checkoutApiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("Failed to fetch processor replay events", response.status);
      return emptyList;
    }

    const payload = (await response.json()) as RawProcessorReplayEvent[];
    const normalized = payload.map((event) => normalizeReplayEvent(event));
    return applyClientSideFilters(normalized, filters);
  } catch (error) {
    console.warn("Failed to load processor replay events", error);
    return emptyList;
  }
}

export async function fetchProcessorReplayDeltas(
  since: string,
  filters: FetchReplayOptions = {},
): Promise<ProcessorReplayEvent[]> {
  return fetchProcessorReplays({ ...filters, since });
}

export async function fetchProcessorReplayDetail(
  eventId: string,
  filters: Pick<FetchReplayOptions, "workspaceId"> = {},
): Promise<ProcessorReplayDetail | null> {
  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; replay dashboard disabled.");
    return null;
  }

  const params = new URLSearchParams();
  if (filters.workspaceId && filters.workspaceId !== "all") {
    params.set("workspaceId", filters.workspaceId);
  }

  const upstreamUrl = `${apiBaseUrl}/api/v1/billing/replays/${eventId}?${params.toString()}`;

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        "X-API-Key": checkoutApiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("Failed to fetch processor replay detail", response.status);
      return null;
    }

    const payload = (await response.json()) as RawProcessorReplayDetail;
    return {
      ...normalizeReplayEvent(payload),
      attempts: payload.attempts.map((attempt) => normalizeReplayAttempt(attempt)),
      invoiceSnapshot: payload.invoiceSnapshot,
    } satisfies ProcessorReplayDetail;
  } catch (error) {
    console.warn("Failed to load processor replay detail", error);
    return null;
  }
}

function normalizeReplayAttempt(attempt: RawProcessorReplayAttempt): ProcessorReplayAttempt {
  return {
    id: attempt.id,
    attemptedAt: attempt.attemptedAt,
    status: attempt.status,
    error: attempt.error,
    metadata: attempt.metadata ?? null,
  } satisfies ProcessorReplayAttempt;
}

function normalizeReplayEvent(event: RawProcessorReplayEvent): ProcessorReplayEvent {
  return {
    ...event,
    status: deriveStatus(event),
  } satisfies ProcessorReplayEvent;
}

function deriveStatus(event: RawProcessorReplayEvent): ProcessorReplayStatus {
  if (event.replayedAt) {
    return "succeeded";
  }
  if (event.lastReplayError) {
    return "failed";
  }
  if (event.replayRequested && event.replayAttempts > 0) {
    return "in-progress";
  }
  if (event.replayRequested) {
    return "queued";
  }
  return "pending";
}

function applyClientSideFilters(
  events: ProcessorReplayEvent[],
  filters: ProcessorReplayFilters,
): ProcessorReplayEvent[] {
  return events.filter((event) => {
    if (filters.workspaceId && filters.workspaceId !== "all") {
      if (filters.workspaceId === "__unassigned__" && event.workspaceId) {
        return false;
      }
      if (filters.workspaceId !== "__unassigned__" && event.workspaceId !== filters.workspaceId) {
        return false;
      }
    }

    if (filters.status && filters.status !== "all" && event.status !== filters.status) {
      return false;
    }

    if (filters.correlationId) {
      const normalized = filters.correlationId.trim().toLowerCase();
      if (normalized && !event.correlationId?.toLowerCase().includes(normalized)) {
        return false;
      }
    }

    return true;
  });
}

export type TriggerProcessorReplayResult = {
  ok: boolean;
  status: number;
  event?: ProcessorReplayEvent;
  error?: string;
};

type HeaderReader = {
  get(name: string): string | null | undefined;
};

export async function triggerProcessorReplay(
  eventId: string,
  options: TriggerReplayOptions = {},
  extraHeaders: HeaderReader | null = null,
  context: Pick<FetchReplayOptions, "workspaceId"> = {},
): Promise<TriggerProcessorReplayResult> {
  if (!checkoutApiKey) {
    return { ok: false, status: 503, error: "Replay console disabled." };
  }
  const params = new URLSearchParams();
  if (context.workspaceId && context.workspaceId !== "all") {
    params.set("workspaceId", context.workspaceId);
  }

  const query = params.toString();
  const upstreamUrl = `${apiBaseUrl}/api/v1/billing/replays/${eventId}/trigger${query ? `?${query}` : ""}`;

  const headers = new Headers({
    "X-API-Key": checkoutApiKey,
    "Content-Type": "application/json",
  });

  if (extraHeaders) {
    ["traceparent", "x-request-id"].forEach((key) => {
      const value = extraHeaders.get(key) ?? null;
      if (value) {
        headers.set(key, value);
      }
    });
  }

  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({ force: Boolean(options.force) }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    const error = errorBody.detail ?? errorBody.error ?? "Unable to trigger replay.";
    return { ok: false, status: response.status, error };
  }

  const body = (await response.json()) as RawProcessorReplayEvent;
  return { ok: true, status: response.status, event: normalizeReplayEvent(body) };
}
