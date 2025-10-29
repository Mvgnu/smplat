// meta: module: auth-policies
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { UserRole } from "@prisma/client";

import { auth } from "./index";

const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";
const bypassUserId = "00000000-0000-0000-0000-000000000001";
const bypassEmail = "bypass@example.com";

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
  allowBypass?: boolean;
  onDenied?: () => never;
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

function fallbackRole(requiredTier: RoleTier): UserRole | null {
  if (requiredTier === "member") {
    return allowBypass ? "CLIENT" : null;
  }

  if (requiredTier === "operator") {
    return allowBypass ? "FINANCE" : null;
  }

  return null;
}

function buildBypassSession(role: UserRole): Session {
  const expires = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  return {
    user: {
      id: bypassUserId,
      email: bypassEmail,
      name: "Bypass User",
      role,
      permissions: role === "ADMIN" ? ["admin:all"] : role === "FINANCE" ? ["operator:manage"] : ["member:read"]
    },
    expires
  } as Session;
}

export async function requireRole(requiredTier: RoleTier, options: RequireRoleOptions = {}): Promise<RequireRoleResult> {
  const session = await auth();
  const redirectTo = options.redirectTo ?? defaultRedirect;
  const bypassEnabled = allowBypass || options.allowBypass;

  if (!session?.user) {
    if (bypassEnabled) {
      const bypassRole = fallbackRole(requiredTier);
      if (bypassRole) {
        return {
          session: buildBypassSession(bypassRole),
          role: bypassRole
        };
      }
    }

    if (options.onDenied) {
      return options.onDenied();
    }

    redirect(redirectTo);
  }

  const resolvedRole = session.user.role;

  if (!ensureRole(resolvedRole, requiredTier)) {
    if (options.onDenied) {
      return options.onDenied();
    }

    throw new Error("User does not have permission to access this resource.");
  }

  return { session: session as Session, role: resolvedRole };
}

export function hasRole(session: Session | null, tier: RoleTier): boolean {
  if (!session?.user?.role) {
    return false;
  }

  return ensureRole(session.user.role, tier);
}
