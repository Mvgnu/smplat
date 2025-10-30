// meta: module: security-access-events
import "server-only";

import { prisma } from "../db/client";
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

const decisionToPrisma = {
  allowed: "ALLOWED",
  denied: "DENIED",
  redirected: "REDIRECTED",
  rate_limited: "RATE_LIMITED"
} as const satisfies Record<AccessEventDecision, "ALLOWED" | "DENIED" | "REDIRECTED" | "RATE_LIMITED">;

type PrismaAccessDecision = (typeof decisionToPrisma)[AccessEventDecision];

const decisionFromPrisma: Record<PrismaAccessDecision, AccessEventDecision> = {
  ALLOWED: "allowed",
  DENIED: "denied",
  REDIRECTED: "redirected",
  RATE_LIMITED: "rate_limited"
};

type RawAccessEvent = {
  id: string;
  route: string;
  method: string | null;
  requiredTier: string;
  decision: PrismaAccessDecision;
  reason: string | null;
  subjectEmail: string | null;
  userId: string | null;
  serviceAccountId: string | null;
  metadata: unknown;
  createdAt: Date;
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

function mapPrismaEvent(event: RawAccessEvent): AccessEventRecord {
  return {
    id: event.id,
    route: event.route,
    method: event.method ?? null,
    requiredTier: event.requiredTier as RoleTier,
    decision: decisionFromPrisma[event.decision],
    reason: event.reason ?? null,
    subjectEmail: event.subjectEmail ?? null,
    userId: event.userId ?? null,
    serviceAccountId: event.serviceAccountId ?? null,
    metadata:
      event.metadata && typeof event.metadata === "object"
        ? (event.metadata as Record<string, unknown>)
        : null,
    createdAt: event.createdAt
  };
}

export async function fetchRecentAccessEvents(
  options: FetchAccessEventsOptions = {}
): Promise<AccessEventRecord[]> {
  const { limit = 50, decisions, since } = options;

  const events = (await prisma.accessEvent.findMany({
    select: {
      id: true,
      route: true,
      method: true,
      requiredTier: true,
      decision: true,
      reason: true,
      subjectEmail: true,
      userId: true,
      serviceAccountId: true,
      metadata: true,
      createdAt: true
    },
    where: {
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(decisions?.length
        ? { decision: { in: decisions.map((decision) => decisionToPrisma[decision]) } }
        : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit
  })) as RawAccessEvent[];

  return events.map(mapPrismaEvent);
}

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

export async function fetchAccessEventMetrics(
  windowHours = 24
): Promise<AccessEventMetrics> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [decisionCounts, uniqueSubjects, adminDenials] = await Promise.all([
    prisma.accessEvent.groupBy({
      by: ["decision"],
      where: {
        createdAt: { gte: windowStart }
      },
      _count: { _all: true }
    }) as Promise<Array<{ decision: PrismaAccessDecision; _count: { _all: number } | null }>>,
    prisma.accessEvent.count({
      where: {
        createdAt: { gte: windowStart },
        subjectEmail: { not: null }
      },
      distinct: ["subjectEmail"]
    }),
    prisma.accessEvent.count({
      where: {
        createdAt: { gte: windowStart },
        requiredTier: "admin",
        decision: decisionToPrisma.denied
      }
    })
  ]);

  const baseline = {
    windowStart,
    windowHours,
    total: 0,
    allowed: 0,
    denied: 0,
    redirected: 0,
    rateLimited: 0,
    uniqueSubjects,
    adminDenials
  } satisfies AccessEventMetrics;

  for (const row of decisionCounts) {
    const count = row._count?._all ?? 0;
    const decision = decisionFromPrisma[row.decision];
    baseline.total += count;
    if (decision === "allowed") {
      baseline.allowed += count;
    } else if (decision === "denied") {
      baseline.denied += count;
    } else if (decision === "redirected") {
      baseline.redirected += count;
    } else if (decision === "rate_limited") {
      baseline.rateLimited += count;
    }
  }

  return baseline;
}

const accessEventLogger = buildStructuredLogger("access-events");

export async function recordAccessEvent(input: RecordAccessEventInput) {
  const data = {
    route: input.route,
    method: input.method ?? null,
    requiredTier: input.requiredTier,
    decision: decisionToPrisma[input.decision],
    reason: input.reason ?? null,
    subjectEmail: input.subjectEmail ?? null,
    metadata: input.metadata ?? undefined,
    serviceAccountId: input.serviceAccountId ?? null,
    userId: input.userId ?? null
  };

  try {
    await prisma.accessEvent.create({ data });
  } catch (error) {
    accessEventLogger.error("failed to persist access event", {
      error: error instanceof Error ? error.message : "unknown",
      route: input.route,
      decision: input.decision
    });
  }
}
