// meta: module: security-access-audit
import { buildStructuredLogger } from "../observability/logger";

export type AccessAuditEvent = {
  path: string;
  method?: string;
  decision: "allowed" | "denied" | "redirected" | "rate_limited";
  reason?: string;
  userId?: string;
  role?: string;
  serviceAccountId?: string;
  ip?: string;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

const accessLogger = buildStructuredLogger("access");

export function logAccessDecision(event: AccessAuditEvent) {
  const payload = {
    decision: event.decision,
    path: event.path,
    method: event.method,
    reason: event.reason,
    userId: event.userId,
    role: event.role,
    serviceAccountId: event.serviceAccountId,
    ip: event.ip,
    userAgent: event.userAgent,
    metadata: event.metadata
  } satisfies Record<string, unknown>;

  if (event.decision === "allowed") {
    accessLogger.info("access decision", payload);
    return;
  }

  if (event.decision === "rate_limited") {
    accessLogger.warn("access rate limited", payload);
    return;
  }

  if (event.decision === "redirected") {
    accessLogger.warn("access redirected", payload);
    return;
  }

  accessLogger.error("access denied", payload);
}
