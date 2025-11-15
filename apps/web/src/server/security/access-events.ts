// meta: module: security-access-events
import "server-only";

import type { RoleTier } from "../auth/policies";
import { buildStructuredLogger } from "../observability/logger";

export type AccessEventDecision = "allowed" | "denied" | "redirected" | "rate_limited";

export type RecordAccessEventInput = {
  userId?: string | null;
  serviceAccountId?: string | null;
  subjectEmail?: string | null;
  route: string;
  method?: string | null;
  requiredTier: RoleTier;
  decision: AccessEventDecision;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type AccessEventRecord = {
  id: string;
  route: string;
  method: string | null;
  requiredTier: RoleTier;
  decision: AccessEventDecision;
  reason: string | null;
  subjectEmail: string | null;
  userId: string | null;
  serviceAccountId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type FetchAccessEventsOptions = {
  limit?: number;
  decisions?: AccessEventDecision[];
  since?: Date;
};

export type AccessEventMetrics = {
  windowStart: Date;
  windowHours: number;
  total: number;
  allowed: number;
  denied: number;
  redirected: number;
  rateLimited: number;
  uniqueSubjects: number;
  adminDenials: number;
};

type ApiAccessEvent = {
  id: string;
  route: string;
  method: string | null;
  required_tier: string;
  decision: string;
  reason: string | null;
  subject_email: string | null;
  user_id: string | null;
  service_account_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ApiAccessEventMetrics = {
  window_start: string;
  window_hours: number;
  total: number;
  allowed: number;
  denied: number;
  redirected: number;
  rate_limited: number;
  unique_subjects: number;
  admin_denials: number;
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const authApiKey =
  process.env.AUTH_API_KEY ??
  process.env.CHECKOUT_API_KEY ??
  process.env.NEXT_PUBLIC_AUTH_API_KEY ??
  undefined;

const accessEventLogger = buildStructuredLogger("access-events");

function buildHeaders(initHeaders: HeadersInit | undefined): Headers {
  const headers = new Headers(initHeaders ?? {});
  headers.set("Content-Type", "application/json");
  if (authApiKey) {
    headers.set("X-API-Key", authApiKey);
  }
  return headers;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: buildHeaders(init.headers),
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await safeReadResponse(response);
    throw new Error(`Security API ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }

  if (response.status === 204) {
    throw new Error("Empty response");
  }

  return (await response.json()) as T;
}

function mapApiEvent(event: ApiAccessEvent): AccessEventRecord {
  return {
    id: event.id,
    route: event.route,
    method: event.method,
    requiredTier: (event.required_tier ?? "member") as RoleTier,
    decision: (event.decision ?? "allowed") as AccessEventDecision,
    reason: event.reason,
    subjectEmail: event.subject_email,
    userId: event.user_id,
    serviceAccountId: event.service_account_id,
    metadata: event.metadata ?? null,
    createdAt: new Date(event.created_at)
  };
}

function mapApiMetrics(metrics: ApiAccessEventMetrics): AccessEventMetrics {
  return {
    windowStart: new Date(metrics.window_start),
    windowHours: metrics.window_hours,
    total: metrics.total,
    allowed: metrics.allowed,
    denied: metrics.denied,
    redirected: metrics.redirected,
    rateLimited: metrics.rate_limited,
    uniqueSubjects: metrics.unique_subjects,
    adminDenials: metrics.admin_denials
  };
}

export async function fetchRecentAccessEvents(
  options: FetchAccessEventsOptions = {}
): Promise<AccessEventRecord[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.decisions?.length) {
    for (const decision of options.decisions) {
      params.append("decisions", decision);
    }
  }
  if (options.since) {
    params.set("since", options.since.toISOString());
  }

  try {
    const events = await fetchJson<ApiAccessEvent[]>(
      `/api/v1/security/access-events${params.toString() ? `?${params.toString()}` : ""}`
    );
    return events.map(mapApiEvent);
  } catch (error) {
    accessEventLogger.error("failed to fetch access events", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return [];
  }
}

export async function fetchAccessEventMetrics(windowHours = 24): Promise<AccessEventMetrics> {
  const params = new URLSearchParams({ window_hours: String(windowHours) });

  try {
    const metrics = await fetchJson<ApiAccessEventMetrics>(
      `/api/v1/security/access-events/metrics?${params.toString()}`
    );
    return mapApiMetrics(metrics);
  } catch (error) {
    accessEventLogger.error("failed to fetch access event metrics", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return {
      windowStart: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      windowHours,
      total: 0,
      allowed: 0,
      denied: 0,
      redirected: 0,
      rateLimited: 0,
      uniqueSubjects: 0,
      adminDenials: 0
    } satisfies AccessEventMetrics;
  }
}

export async function recordAccessEvent(input: RecordAccessEventInput) {
  const payload = {
    route: input.route,
    method: input.method ?? null,
    required_tier: input.requiredTier,
    decision: input.decision,
    reason: input.reason ?? null,
    subject_email: input.subjectEmail ?? null,
    user_id: input.userId ?? null,
    service_account_id: input.serviceAccountId ?? null,
    metadata: input.metadata ?? null
  };

  try {
    await fetch(`${apiBaseUrl}/api/v1/security/access-events`, {
      method: "POST",
      headers: buildHeaders(undefined),
      cache: "no-store",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    accessEventLogger.error("failed to record access event", {
      error: error instanceof Error ? error.message : "unknown",
      route: input.route,
      decision: input.decision
    });
  }
}

async function safeReadResponse(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (data && typeof data === "object" && "detail" in data) {
      return String((data as { detail?: unknown }).detail);
    }
    return JSON.stringify(data);
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}
