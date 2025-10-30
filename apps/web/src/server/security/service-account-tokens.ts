// meta: module: security-service-account-tokens
import { RoleTier } from "../auth/policies";

type ServiceAccountConfig = {
  id: string;
  name?: string;
  tiers: RoleTier[];
};

type ParsedServiceAccounts = {
  accounts: ServiceAccountConfig[];
  secret: string | null;
};

const memoizedConfig: ParsedServiceAccounts = (() => {
  const rawAccounts = process.env.MAINTENANCE_SERVICE_ACCOUNTS;
  const secret = process.env.MAINTENANCE_TOKEN_SECRET ?? null;

  if (!rawAccounts) {
    return { accounts: [], secret };
  }

  try {
    const parsed = JSON.parse(rawAccounts);
    if (!Array.isArray(parsed)) {
      return { accounts: [], secret };
    }

    const accounts: ServiceAccountConfig[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const id = "id" in entry && typeof entry.id === "string" ? entry.id : null;
      if (!id) {
        continue;
      }

      const tiers = Array.isArray((entry as { tiers?: unknown }).tiers)
        ? ((entry as { tiers?: unknown[] }).tiers!.filter(
            (tier: unknown): tier is RoleTier => tier === "member" || tier === "operator" || tier === "admin"
          ))
        : [];

      if (tiers.length === 0) {
        continue;
      }

      const name = "name" in entry && typeof entry.name === "string" ? entry.name : undefined;
      accounts.push({ id, name, tiers });
    }

    return { accounts, secret };
  } catch (error) {
    console.warn("Failed to parse MAINTENANCE_SERVICE_ACCOUNTS", error);
    return { accounts: [], secret };
  }
})();

const encoder = new TextEncoder();

function bufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bufferToBase64Url(signature);
}

export type ResolvedServiceAccount = ServiceAccountConfig & {
  expires: number;
};

export async function verifyMaintenanceToken(token: string | null | undefined): Promise<ResolvedServiceAccount | null> {
  if (!token || memoizedConfig.accounts.length === 0 || !memoizedConfig.secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [accountId, expires, signature] = parts;
  const expiresAt = Number.parseInt(expires, 10);

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  const account = memoizedConfig.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return null;
  }

  const expected = await hmacSign(`${accountId}.${expires}`, memoizedConfig.secret);
  if (expected !== signature) {
    return null;
  }

  return { ...account, expires: expiresAt };
}
