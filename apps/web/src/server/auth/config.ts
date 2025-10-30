import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "../db/client";
import { getMailer } from "../email/mailer";
import { renderSignInEmail } from "@smplat/shared";
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { UserRole } from "@prisma/client";
import { computeFingerprintFromRequest } from "./fingerprint";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const lockoutThreshold = Number.parseInt(process.env.AUTH_LOCKOUT_THRESHOLD ?? "5", 10);
const lockoutWindowMinutes = Number.parseInt(process.env.AUTH_LOCKOUT_WINDOW_MINUTES ?? "15", 10);

// security-lockout: auth-attempt-telemetry
async function trackAuthAttempt(identifier: string | null | undefined, outcome: "success" | "failure") {
  if (!identifier) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    await fetch(`${apiBaseUrl}/api/v1/auth/attempts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ identifier, outcome }),
      signal: controller.signal
    });
  } catch (error) {
    console.warn("Failed to report auth attempt", error);
  } finally {
    clearTimeout(timeout);
  }
}

const rolePermissions: Record<UserRole, string[]> = {
  CLIENT: ["member:read"],
  FINANCE: ["member:read", "operator:manage"],
  ADMIN: ["member:read", "operator:manage", "admin:all"]
};

function resolvePermissions(role: UserRole | undefined | null): string[] {
  if (!role) {
    return [];
  }

  return rolePermissions[role] ?? [];
}

// security-cookie-policy: strict-lax-samesite
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database"
  },
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Host-smplat.session-token" : "smplat.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      }
    },
    callbackUrl: {
      name: process.env.NODE_ENV === "production" ? "__Secure-smplat.callback-url" : "smplat.callback-url",
      options: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      }
    },
    csrfToken: {
      name: process.env.NODE_ENV === "production" ? "__Host-smplat.csrf-token" : "smplat.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      }
    }
  },
  callbacks: {
    async jwt({ token, user, trigger }, request) {
      const mutableToken = token as JWT & {
        id?: string;
        role?: UserRole;
        permissions?: string[];
        deviceFingerprint?: string | null;
        deviceIp?: string | null;
        deviceUserAgent?: string | null;
        deviceMismatch?: boolean;
        lockoutThreshold?: number;
        lockoutWindowMinutes?: number;
      };

      if (user) {
        const userWithRole = user as { id?: string; role?: UserRole | null };
        mutableToken.id = userWithRole.id ?? mutableToken.sub;
        if (userWithRole.role) {
          mutableToken.role = userWithRole.role;
        }
        mutableToken.permissions = resolvePermissions(userWithRole.role ?? mutableToken.role ?? null);
        const fingerprint = computeFingerprintFromRequest(request);
        mutableToken.deviceFingerprint = fingerprint.hash;
        mutableToken.deviceIp = fingerprint.ip;
        mutableToken.deviceUserAgent = fingerprint.userAgent;
        mutableToken.deviceMismatch = false;
      }
      if (!user || trigger !== "signIn") {
        const fingerprint = computeFingerprintFromRequest(request);
        if (fingerprint.hash) {
          if (!mutableToken.deviceFingerprint) {
            mutableToken.deviceFingerprint = fingerprint.hash;
            mutableToken.deviceIp = fingerprint.ip;
            mutableToken.deviceUserAgent = fingerprint.userAgent;
            mutableToken.deviceMismatch = false;
          } else if (mutableToken.deviceFingerprint !== fingerprint.hash) {
            mutableToken.deviceMismatch = true;
          } else {
            mutableToken.deviceMismatch = false;
          }
        }
      }

      mutableToken.lockoutThreshold = lockoutThreshold;
      mutableToken.lockoutWindowMinutes = lockoutWindowMinutes;

      return mutableToken;
    },
    async session({ session, token }) {
      if (session.user) {
        const jwtToken = token as JWT & {
          id?: string;
          role?: UserRole;
          permissions?: string[];
          deviceFingerprint?: string | null;
          deviceIp?: string | null;
          deviceUserAgent?: string | null;
          deviceMismatch?: boolean;
          lockoutThreshold?: number;
          lockoutWindowMinutes?: number;
        };
        const mutableUser = session.user as DefaultSession["user"] & {
          id?: string;
          role?: UserRole;
          permissions?: string[];
        };
        mutableUser.id = jwtToken.id ?? jwtToken.sub ?? mutableUser.id ?? "";
        mutableUser.role = jwtToken.role ?? mutableUser.role;
        mutableUser.permissions = Array.from(new Set([...(mutableUser.permissions ?? []), ...(jwtToken.permissions ?? [])]));

        const security = (session as DefaultSession & {
          security?: {
            deviceBinding: {
              valid: boolean;
              fingerprint: string | null;
              ip: string | null;
              userAgent: string | null;
            };
            lockout: {
              threshold: number;
              windowMinutes: number;
            };
          };
        }).security ?? {
          deviceBinding: { valid: true, fingerprint: null, ip: null, userAgent: null },
          lockout: { threshold: lockoutThreshold, windowMinutes: lockoutWindowMinutes }
        };

        security.deviceBinding = {
          valid: jwtToken.deviceMismatch !== true,
          fingerprint: jwtToken.deviceFingerprint ?? null,
          ip: jwtToken.deviceIp ?? null,
          userAgent: jwtToken.deviceUserAgent ?? null
        };

        security.lockout = {
          threshold: jwtToken.lockoutThreshold ?? lockoutThreshold,
          windowMinutes: jwtToken.lockoutWindowMinutes ?? lockoutWindowMinutes
        };

        (session as DefaultSession & { security?: typeof security }).security = security;
      }
      return session;
    }
  },
  events: {
    async createSession({ session, token }) {
      if (!session?.sessionToken) {
        return;
      }

      const jwtToken = token as JWT & {
        role?: UserRole;
        permissions?: string[];
        deviceFingerprint?: string | null;
        deviceIp?: string | null;
        deviceUserAgent?: string | null;
      };
      try {
        await prisma.session.update({
          where: { sessionToken: session.sessionToken },
          data: {
            roleSnapshot: jwtToken.role ?? null,
            permissions: jwtToken.permissions ?? [],
            deviceFingerprint: jwtToken.deviceFingerprint ?? null,
            ipAddress: jwtToken.deviceIp ?? null,
            userAgent: jwtToken.deviceUserAgent ?? null
          }
        });
      } catch (error) {
        console.warn("Failed to persist session role snapshot", error);
      }

      await trackAuthAttempt(session.user?.email ?? jwtToken.email ?? null, "success");
    },
    async updateSession({ session, token }) {
      if (!session?.sessionToken) {
        return;
      }

      const jwtToken = token as JWT & {
        role?: UserRole;
        permissions?: string[];
        deviceFingerprint?: string | null;
        deviceIp?: string | null;
        deviceUserAgent?: string | null;
      };
      try {
        await prisma.session.update({
          where: { sessionToken: session.sessionToken },
          data: {
            roleSnapshot: jwtToken.role ?? null,
            permissions: jwtToken.permissions ?? [],
            deviceFingerprint: jwtToken.deviceFingerprint ?? null,
            ipAddress: jwtToken.deviceIp ?? null,
            userAgent: jwtToken.deviceUserAgent ?? null
          }
        });
      } catch (error) {
        console.warn("Failed to update session role snapshot", error);
      }
    }
  },
  providers: [
    EmailProvider({
      name: "Email",
      from: process.env.EMAIL_FROM,
      server: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      },
      async sendVerificationRequest({ identifier, url }) {
        const mailer = getMailer();
        const { subject, html, text } = renderSignInEmail({
          verificationUrl: url,
          recipient: identifier
        });

        await mailer.send({
          to: {
            email: identifier
          },
          subject,
          html,
          text
        });
      }
    })
  ],
  pages: {
    signIn: "/login"
  }
};
