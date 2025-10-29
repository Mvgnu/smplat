import "server-only";

// meta: module: loyalty-guardrail-console

import type {
  LoyaltyGuardrailOverride,
  LoyaltyGuardrailOverrideScope,
  LoyaltyGuardrailSnapshot
} from "@smplat/types";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY ?? process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";

type GuardrailOverrideInput = {
  scope: LoyaltyGuardrailOverrideScope;
  justification: string;
  actorUserId?: string | null;
  targetMemberId?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

const defaultHeaders: HeadersInit = apiKeyHeader
  ? { "X-API-Key": apiKeyHeader, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

export function buildBypassGuardrailSnapshot(): LoyaltyGuardrailSnapshot {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60);
  return {
    inviteQuota: 5,
    totalActiveInvites: 2,
    membersAtQuota: 1,
    cooldownSeconds: 300,
    cooldownRemainingSeconds: 120,
    cooldownUntil: expires.toISOString(),
    throttleOverrideActive: false,
    overrides: [
      {
        id: "override-demo",
        scope: "invite_cooldown",
        justification: "Demo bypass for E2E",
        metadata: { operator: "demo" },
        targetMemberId: null,
        createdByUserId: "00000000-0000-0000-0000-000000000111",
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        revokedAt: null,
        isActive: true
      }
    ]
  };
}

export async function fetchGuardrailSnapshot(): Promise<LoyaltyGuardrailSnapshot> {
  if (allowBypass || !apiKeyHeader) {
    return buildBypassGuardrailSnapshot();
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/loyalty/guardrails`, {
    cache: "no-store",
    headers: defaultHeaders
  });

  if (!response.ok) {
    throw new Error(`Failed to load loyalty guardrail snapshot: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyGuardrailSnapshot;
}

export async function createGuardrailOverride(
  input: GuardrailOverrideInput
): Promise<LoyaltyGuardrailOverride> {
  if (allowBypass || !apiKeyHeader) {
    const now = new Date();
    return {
      id: `override-${now.getTime()}`,
      scope: input.scope,
      justification: input.justification,
      metadata: input.metadata ?? {},
      targetMemberId: input.targetMemberId ?? null,
      createdByUserId: input.actorUserId ?? null,
      createdAt: now.toISOString(),
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      isActive: true
    } satisfies LoyaltyGuardrailOverride;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/loyalty/guardrails/overrides`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({
      scope: input.scope,
      justification: input.justification,
      actorUserId: input.actorUserId,
      targetMemberId: input.targetMemberId,
      expiresAt: input.expiresAt,
      metadata: input.metadata
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to create guardrail override: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyGuardrailOverride;
}
