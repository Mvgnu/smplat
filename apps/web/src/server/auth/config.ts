import type { NextAuthConfig } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { getMailer } from "../email/mailer";
import { renderSignInEmail } from "@smplat/shared";
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { computeFingerprintFromRequest } from "./fingerprint";
import { createRestAdapter } from "./rest-adapter";
import type { UserRole } from "./types";
import { toApiRole, toFrontendRole } from "./types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const authApiKey =
  process.env.AUTH_API_KEY ??
  process.env.CHECKOUT_API_KEY ??
  process.env.NEXT_PUBLIC_AUTH_API_KEY ??
  undefined;

type AuthApiUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  email_verified_at: string | null;
};

async function authApiFetch<T>(
  path: string,
  init: RequestInit = {},
  allowNotFound = false
): Promise<T | null> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authApiKey) {
    headers.set("X-API-Key", authApiKey);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await safeReadResponse(response);
    throw new Error(`Auth API ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
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

async function upsertDevShortcutUser(entry: { email: string; displayName: string; role: UserRole }) {
  const email = entry.email.toLowerCase();
  const nowIso = new Date().toISOString();
  const params = new URLSearchParams({ email });

  const existing = await authApiFetch<AuthApiUser>(
    `/api/v1/auth/users/by-email?${params.toString()}`,
    {},
    true
  );

  let user: AuthApiUser;

  if (!existing) {
    user = await authApiFetch<AuthApiUser>(
      "/api/v1/auth/users",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          display_name: entry.displayName,
          role: toApiRole(entry.role) ?? "client",
          status: "active",
          email_verified_at: nowIso
        })
      }
    ) as AuthApiUser;
  } else {
    user = await authApiFetch<AuthApiUser>(
      `/api/v1/auth/users/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          display_name: entry.displayName,
          role: toApiRole(entry.role) ?? "client",
          status: "active",
          email_verified_at: nowIso,
          is_email_verified: true
        })
      }
    ) as AuthApiUser;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.display_name ?? entry.displayName,
    role: toFrontendRole(user.role) ?? entry.role,
    devShortcut: true
  } as {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    devShortcut: boolean;
  };
}

const cmsEnvironment = (process.env.CMS_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
const enableDevShortcuts = cmsEnvironment === "development";

const devShortcutUsers = {
  customer: {
    email: process.env.DEV_SHORTCUT_CUSTOMER_EMAIL ?? "customer@smplat.dev",
    displayName: "Customer QA",
    role: "CLIENT" as UserRole
  },
  admin: {
    email: process.env.DEV_SHORTCUT_ADMIN_EMAIL ?? "admin@smplat.dev",
    displayName: "Admin QA",
    role: "ADMIN" as UserRole
  },
  testing: {
    email: process.env.DEV_SHORTCUT_TESTING_EMAIL ?? "testing@smplat.dev",
    displayName: "Testing QA",
    role: "CLIENT" as UserRole
  },
  analysis: {
    email: process.env.DEV_SHORTCUT_ANALYSIS_EMAIL ?? "analysis@smplat.dev",
    displayName: "Analysis QA",
    role: "FINANCE" as UserRole
  }
} satisfies Record<string, { email: string; displayName: string; role: UserRole }>;

const lockoutThreshold = Number.parseInt(process.env.AUTH_LOCKOUT_THRESHOLD ?? "5", 10);
const lockoutWindowMinutes = Number.parseInt(process.env.AUTH_LOCKOUT_WINDOW_MINUTES ?? "15", 10);

// security-lockout: auth-attempt-telemetry
function trackAuthAttempt(identifier: string | null | undefined, outcome: "success" | "failure") {
  if (!identifier) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  void fetch(`${apiBaseUrl}/api/v1/auth/attempts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ identifier, outcome }),
    signal: controller.signal
  })
    .catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug("Skipped auth attempt telemetry", (error as Error)?.message ?? error);
        return;
      }
      console.warn("Failed to report auth attempt", error);
    })
    .finally(() => {
      clearTimeout(timeout);
    });
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

type AuthCallbacks = NonNullable<NextAuthConfig["callbacks"]>;
type JwtCallback = Exclude<AuthCallbacks["jwt"], undefined>;
type JwtCallbackParams = JwtCallback extends (...args: infer P) => any ? P : never;
type JwtCallbackReturn = JwtCallback extends (...args: any[]) => infer R ? R : Promise<JWT>;
type SessionCallback = Exclude<AuthCallbacks["session"], undefined>;

const jwtCallbackImpl = async (
  params: JwtCallbackParams[0],
  request?: Request | NextRequest
) => {
  const { token, user, trigger } = params;
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
    const userWithRole = user as {
      id?: string;
      role?: UserRole | null;
      email?: string | null;
      devShortcut?: boolean;
    };
    if (!userWithRole.devShortcut) {
      const identifier = userWithRole.email ?? (token as { email?: string }).email ?? null;
      trackAuthAttempt(identifier, "success");
    }
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
};

const jwtCallback = ((params: JwtCallbackParams[0], ...rest: unknown[]) =>
  jwtCallbackImpl(params, rest[0] as Request | NextRequest | undefined)) as unknown as JwtCallback;

const sessionCallback: SessionCallback = async ({ session, token }) => {
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

    const security =
      (session as DefaultSession & {
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
};

// security-cookie-policy: strict-lax-samesite
export const authConfig: NextAuthConfig = {
  adapter: createRestAdapter({ apiBaseUrl, apiKey: authApiKey }),
  session: {
    strategy: "jwt"
  },
  trustHost: true,
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
    jwt: jwtCallback,
    session: sessionCallback
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
    }),
    ...(enableDevShortcuts
      ? [
          CredentialsProvider({
            id: "dev-shortcut",
            name: "Development Shortcut",
            credentials: {
              userKey: {
                label: "Dev user key",
                type: "text"
              }
            },
            async authorize(credentials) {
              const key = typeof credentials?.userKey === "string" ? credentials.userKey.toLowerCase() : null;
              if (!key) {
                return null;
              }

              const entry = devShortcutUsers[key as keyof typeof devShortcutUsers];
              if (!entry) {
                trackAuthAttempt(null, "failure");
                return null;
              }

              try {
                const user = await upsertDevShortcutUser(entry);
                trackAuthAttempt(entry.email, "success");
                return user as any;
              } catch (error) {
                trackAuthAttempt(entry.email, "failure");
                if (process.env.NODE_ENV !== "production") {
                  console.error("Failed to upsert dev shortcut user", error);
                }
                return null;
              }
            }
          })
        ]
      : [])
  ],
  pages: {
    signIn: "/login"
  }
};
