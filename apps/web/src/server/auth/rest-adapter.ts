import type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken
} from "next-auth/adapters";
import type { UserRole, UserStatus } from "./types";
import { toApiRole, toApiStatus, toFrontendRole, toFrontendStatus } from "./types";

type RestAdapterOptions = {
  apiBaseUrl?: string;
  apiKey?: string;
};

type ApiUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  email_verified_at: string | null;
  is_email_verified: boolean;
};

type ApiAccountResponse = {
  account: ApiAccount;
  user: ApiUser;
};

type ApiAccount = {
  id: string;
  user_id: string;
  type: string;
  provider: string;
  provider_account_id: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  session_state: string | null;
  created_at: string;
  updated_at: string;
};

type ApiSession = {
  id: string;
  session_token: string;
  user_id: string;
  expires: string;
  role_snapshot: string | null;
  permissions: string[];
  ip_address: string | null;
  user_agent: string | null;
  device_fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

type ApiSessionWithUser = {
  session: ApiSession;
  user: ApiUser;
};

type ApiVerificationToken = {
  identifier: string;
  token: string;
  expires: string;
  created_at: string;
};

type ExtendedAdapterUser = AdapterUser & {
  role?: UserRole;
  status?: UserStatus;
  isEmailVerified?: boolean;
};

type ExtendedAdapterSession = AdapterSession & {
  role?: UserRole | null;
};

type JsonFetchInit = RequestInit & { headers?: HeadersInit };

const ensureResult = <T>(value: T | null, context: string): T => {
  if (value == null) {
    throw new Error(`Expected response body for ${context}, received null`);
  }
  return value;
};

const toHeaderRecord = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers
        .filter(([key, value]) => typeof key === "string" && typeof value === "string")
        .map(([key, value]) => [key as string, value as string])
    );
  }
  return { ...(headers as Record<string, string>) };
};

const DEFAULT_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function createRestAdapter(options: RestAdapterOptions = {}): Adapter {
  const baseUrl = (options.apiBaseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey =
    options.apiKey ??
    process.env.AUTH_API_KEY ??
    process.env.CHECKOUT_API_KEY ??
    process.env.NEXT_PUBLIC_AUTH_API_KEY;

  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    defaultHeaders["X-API-Key"] = apiKey;
  }

  async function fetchJson<T>(
    path: string,
    init: JsonFetchInit = {},
    allowNotFound = false
  ): Promise<T | null> {
    const headers: Record<string, string> = {
      ...defaultHeaders,
      ...toHeaderRecord(init.headers)
    };

    const response = await fetch(`${baseUrl}${path}`, {
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

  const adapter: Adapter = {
    async createUser(user) {
      const payload = {
        email: user.email?.toLowerCase(),
        display_name: user.name ?? null,
        email_verified_at: user.emailVerified?.toISOString() ?? null,
        status: "active"
      };
      const result = await fetchJson<ApiUser>("/api/v1/auth/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return mapUserFromApi(ensureResult(result, "createUser"));
    },

    async getUser(id) {
      const result = await fetchJson<ApiUser>(`/api/v1/auth/users/${id}`, {}, true);
      return result ? mapUserFromApi(result) : null;
    },

    async getUserByEmail(email) {
      const params = new URLSearchParams({ email });
      const result = await fetchJson<ApiUser>(`/api/v1/auth/users/by-email?${params.toString()}`, {}, true);
      return result ? mapUserFromApi(result) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const params = new URLSearchParams({
        provider,
        provider_account_id: providerAccountId
      });
      const result = await fetchJson<ApiAccountResponse>(
        `/api/v1/auth/accounts/by-provider?${params.toString()}`,
        {},
        true
      );
      return result ? mapUserFromApi(result.user) : null;
    },

    async updateUser(user) {
      if (!user.id) {
        throw new Error("Cannot update user without id");
      }
      const payload: Record<string, unknown> = {};
      if (user.name !== undefined) {
        payload.display_name = user.name;
      }
      if (user.emailVerified !== undefined) {
        payload.email_verified_at = user.emailVerified ? user.emailVerified.toISOString() : null;
        payload.is_email_verified = Boolean(user.emailVerified);
      }
      const userWithRole = user as AdapterUser & { role?: UserRole };
      if (userWithRole.role !== undefined) {
        const apiRole = toApiRole(userWithRole.role ?? null);
        if (apiRole) {
          payload.role = apiRole;
        }
      }
      const userWithStatus = user as AdapterUser & { status?: UserStatus };
      if (userWithStatus.status !== undefined) {
        const apiStatus = toApiStatus(userWithStatus.status ?? null);
        if (apiStatus) {
          payload.status = apiStatus;
        }
      }

      const result = await fetchJson<ApiUser>(`/api/v1/auth/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      return mapUserFromApi(ensureResult(result, "updateUser"));
    },

    async deleteUser(userId) {
      await fetchJson<null>(`/api/v1/auth/users/${userId}`, { method: "DELETE" }, true);
    },

    async linkAccount(account) {
      const payload = mapAccountToPayload(account);
      const result = await fetchJson<ApiAccount>("/api/v1/auth/accounts", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return mapAccountFromApi(ensureResult(result, "linkAccount"));
    },

    async unlinkAccount(account) {
      const payload = {
        provider: account.provider,
        provider_account_id: account.providerAccountId
      };
      await fetchJson<null>("/api/v1/auth/accounts", {
        method: "DELETE",
        body: JSON.stringify(payload)
      });
    },

    async createSession(session) {
      const payload = mapSessionToPayload(session);
      const result = await fetchJson<ApiSession>("/api/v1/auth/sessions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return mapSessionFromApi(ensureResult(result, "createSession"));
    },

    async getSessionAndUser(sessionToken) {
      const result = await fetchJson<ApiSessionWithUser>(
        `/api/v1/auth/sessions/${encodeURIComponent(sessionToken)}`,
        {},
        true
      );
      if (!result) {
        return null;
      }
      return {
        session: mapSessionFromApi(result.session),
        user: mapUserFromApi(result.user)
      };
    },

    async updateSession(session) {
      const payload: Record<string, unknown> = {};
      if (session.expires !== undefined) {
        payload.expires = session.expires?.toISOString() ?? null;
      }
      const result = await fetchJson<ApiSession>(
        `/api/v1/auth/sessions/${encodeURIComponent(session.sessionToken)}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload)
        }
      );
      return mapSessionFromApi(ensureResult(result, "updateSession"));
    },

    async deleteSession(sessionToken) {
      await fetchJson<null>(
        `/api/v1/auth/sessions/${encodeURIComponent(sessionToken)}`,
        { method: "DELETE" },
        true
      );
    },

    async createVerificationToken(token) {
      const payload = {
        identifier: token.identifier,
        token: token.token,
        expires: token.expires.toISOString()
      };
      const result = await fetchJson<ApiVerificationToken>("/api/v1/auth/verification-tokens", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return mapVerificationTokenFromApi(ensureResult(result, "createVerificationToken"));
    },

    async useVerificationToken(token) {
      const payload = {
        identifier: token.identifier,
        token: token.token
      };
      const result = await fetchJson<ApiVerificationToken>(
        "/api/v1/auth/verification-tokens/use",
        {
          method: "POST",
          body: JSON.stringify(payload)
        },
        true
      );
      return result ? mapVerificationTokenFromApi(result) : null;
    }
  };

  return adapter;
}

function mapUserFromApi(user: ApiUser): ExtendedAdapterUser {
  const role = toFrontendRole(user.role);
  const status = toFrontendStatus(user.status);
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    emailVerified: user.email_verified_at ? new Date(user.email_verified_at) : null,
    image: null,
    role,
    status,
    isEmailVerified: user.is_email_verified
  } as ExtendedAdapterUser;
}

function mapAccountFromApi(account: ApiAccount): AdapterAccount {
  const toUndefined = <T>(value: T | null): T | undefined => (value == null ? undefined : value);
  return {
    id: account.id,
    userId: account.user_id,
    type: (account.type as AdapterAccount["type"]) ?? "oauth",
    provider: account.provider,
    providerAccountId: account.provider_account_id,
    refresh_token: toUndefined(account.refresh_token),
    access_token: toUndefined(account.access_token),
    expires_at: toUndefined(account.expires_at),
    token_type: account.token_type ? (account.token_type.toLowerCase() as Lowercase<string>) : undefined,
    scope: toUndefined(account.scope),
    id_token: toUndefined(account.id_token),
    session_state: toUndefined(account.session_state)
  };
}

function mapAccountToPayload(account: AdapterAccount): Record<string, unknown> {
  return {
    user_id: account.userId,
    type: account.type,
    provider: account.provider,
    provider_account_id: account.providerAccountId,
    refresh_token: account.refresh_token ?? null,
    access_token: account.access_token ?? null,
    expires_at: account.expires_at ?? null,
    token_type: account.token_type ?? null,
    scope: account.scope ?? null,
    id_token: account.id_token ?? null,
    session_state: account.session_state ?? null
  };
}

function mapSessionFromApi(session: ApiSession): ExtendedAdapterSession {
  const role = toFrontendRole(session.role_snapshot);
  return {
    id: session.id,
    userId: session.user_id,
    sessionToken: session.session_token,
    expires: new Date(session.expires),
    role
  } as ExtendedAdapterSession;
}

function mapSessionToPayload(session: AdapterSession): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    session_token: session.sessionToken,
    user_id: session.userId,
    expires: session.expires.toISOString()
  };
  const role = (session as AdapterSession & { role?: UserRole }).role;
  const apiRole = toApiRole(role ?? null);
  if (apiRole) {
    payload.role_snapshot = apiRole;
  }
  return payload;
}

function mapVerificationTokenFromApi(token: ApiVerificationToken): VerificationToken {
  return {
    identifier: token.identifier,
    token: token.token,
    expires: new Date(token.expires)
  };
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
