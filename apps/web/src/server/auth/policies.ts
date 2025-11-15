// meta: module: auth-policies
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { UserRole } from "./types";

import { auth } from "./index";
import { recordAccessEvent } from "../security/access-events";

const roleRank: Record<UserRole, number> = {
  CLIENT: 0,
  FINANCE: 1,
  ADMIN: 2
};

export type RoleTier = "member" | "operator" | "admin";

const tierRank: Record<RoleTier, number> = {
  member: 0,
  operator: 1,
  admin: 2
};

const defaultRedirect = "/login";

export type RequireRoleOptions = {
  redirectTo?: string;
  onDenied?: () => never;
  context?: {
    route?: string;
    method?: string;
    serviceAccountId?: string;
    subjectEmail?: string;
  };
};

type RequireRoleResult = {
  session: Session;
  role: UserRole;
};

function ensureRole(role: UserRole | undefined | null, requiredTier: RoleTier): role is UserRole {
  if (!role) {
    return false;
  }

  const rank = roleRank[role];
  const requiredRank = tierRank[requiredTier];
  return typeof rank === "number" && rank >= requiredRank;
}

export async function requireRole(requiredTier: RoleTier, options: RequireRoleOptions = {}): Promise<RequireRoleResult> {
  const session = await auth();
  const redirectTo = options.redirectTo ?? defaultRedirect;
  const context = options.context ?? {};
  const route = context.route ?? "unknown";
  const method = context.method;

  if (!session?.user) {
    await recordAccessEvent({
      decision: "redirected",
      reason: "unauthenticated",
      route,
      method,
      requiredTier,
      serviceAccountId: context.serviceAccountId,
      subjectEmail: context.subjectEmail ?? null
    });
    if (options.onDenied) {
      return options.onDenied();
    }

    redirect(redirectTo);
  }

  const resolvedRole = session.user.role;

  if (!ensureRole(resolvedRole, requiredTier)) {
    await recordAccessEvent({
      decision: "denied",
      reason: "insufficient_role",
      route,
      method,
      requiredTier,
      userId: session.user.id,
      subjectEmail: session.user.email ?? null,
      serviceAccountId: context.serviceAccountId
    });
    if (options.onDenied) {
      return options.onDenied();
    }

    throw new Error("User does not have permission to access this resource.");
  }

  await recordAccessEvent({
    decision: "allowed",
    route,
    method,
    requiredTier,
    userId: session.user.id,
    subjectEmail: session.user.email ?? null,
    serviceAccountId: context.serviceAccountId
  });

  return { session: session as Session, role: resolvedRole };
}

export function hasRole(session: Session | null, tier: RoleTier): boolean {
  if (!session?.user?.role) {
    return false;
  }

  return ensureRole(session.user.role, tier);
}
