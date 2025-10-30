"use server";

import type {
  LoyaltyRedemption,
  ReferralInviteCancelPayload,
  ReferralInviteCreatePayload,
  ReferralInviteResponse
} from "@smplat/types";

import { requireRole } from "@/server/auth/policies";
import { ensureCsrfToken } from "@/server/security/csrf";
import {
  cancelMemberReferral,
  createMemberReferral
} from "@/lib/loyalty/referrals";
import { serverTelemetry } from "@/server/observability/tracing";

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY || process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const bypassUserId = "00000000-0000-0000-0000-000000000001";

export type RedemptionRequestPayload = {
  rewardSlug?: string;
  pointsCost?: number;
  quantity?: number;
  metadata?: Record<string, unknown>;
  csrfToken?: string;
};

async function requestRedemptionImpl(payload: RedemptionRequestPayload): Promise<LoyaltyRedemption> {
  const { csrfToken: csrfFromPayload, ...requestPayload } = payload;
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.loyalty.requestRedemption",
      method: "POST"
    }
  });
  ensureCsrfToken({ tokenFromForm: csrfFromPayload ?? null });
  const userId = session.user?.id;

  if (!userId) {
    throw new Error("Authentication is required to redeem rewards.");
  }

  if (!apiKeyHeader) {
    return buildBypassRedemption(payload.rewardSlug ?? "reward-1");
  }

  const body = {
    rewardSlug: requestPayload.rewardSlug,
    pointsCost: requestPayload.pointsCost,
    quantity: requestPayload.quantity ?? 1,
    metadata: requestPayload.metadata ?? {}
  };

  const response = await fetch(`${apiBase}/api/v1/loyalty/members/${userId}/redemptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create loyalty redemption");
  }

  return (await response.json()) as LoyaltyRedemption;
}

export const requestRedemption = serverTelemetry.wrapServerAction(
  "storefront.loyalty.requestRedemption",
  requestRedemptionImpl,
  { "server.action.feature": "loyalty", "server.action.surface": "storefront" }
);

function buildBypassRedemption(rewardSlug: string): LoyaltyRedemption {
  return {
    id: `stub-${rewardSlug}-${Date.now()}`,
    memberId: "00000000-0000-0000-0000-000000000001",
    rewardId: rewardSlug,
    status: "REQUESTED",
    pointsCost: 750,
    quantity: 1,
    requestedAt: new Date().toISOString(),
    fulfilledAt: null,
    cancelledAt: null,
    failureReason: null
  };
}

async function issueReferralInviteImpl(
  payload: ReferralInviteCreatePayload & { csrfToken?: string }
): Promise<ReferralInviteResponse> {
  const { csrfToken: csrfFromPayload, ...requestPayload } = payload;
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.loyalty.issueReferral",
      method: "POST"
    }
  });
  ensureCsrfToken({ tokenFromForm: csrfFromPayload ?? null });
  const userId = session.user?.id;

  if (!userId) {
    throw new Error("Authentication is required to issue referrals.");
  }

  try {
    return await createMemberReferral(userId, requestPayload);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Failed to create referral invite");
  }
}

export const issueReferralInvite = serverTelemetry.wrapServerAction(
  "storefront.loyalty.issueReferral",
  issueReferralInviteImpl,
  { "server.action.feature": "loyalty", "server.action.surface": "storefront" }
);

async function cancelReferralInviteImpl(
  referralId: string,
  payload: ReferralInviteCancelPayload & { csrfToken?: string } = {}
): Promise<ReferralInviteResponse> {
  const { csrfToken: csrfFromPayload, ...requestPayload } = payload;
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.loyalty.cancelReferral",
      method: "POST"
    }
  });
  ensureCsrfToken({ tokenFromForm: csrfFromPayload ?? null });
  const userId = session.user?.id;

  if (!userId) {
    throw new Error("Authentication is required to manage referrals.");
  }

  try {
    return await cancelMemberReferral(userId, referralId, requestPayload);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Failed to cancel referral invite");
  }
}

export const cancelReferralInvite = serverTelemetry.wrapServerAction(
  "storefront.loyalty.cancelReferral",
  cancelReferralInviteImpl,
  { "server.action.feature": "loyalty", "server.action.surface": "storefront" }
);

export type LoyaltyNudgeStatus = "active" | "acknowledged" | "dismissed";

async function updateNudgeStatusImpl(
  nudgeId: string,
  status: LoyaltyNudgeStatus,
  csrfToken?: string
): Promise<void> {
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.loyalty.updateNudge",
      method: "POST"
    }
  });
  ensureCsrfToken({ tokenFromForm: csrfToken ?? null });
  const userId = session.user?.id;

  if (!userId) {
    throw new Error("Authentication is required to manage nudges.");
  }

  if (!apiKeyHeader) {
    return;
  }

  const response = await fetch(`${apiBase}/api/v1/loyalty/nudges/${nudgeId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKeyHeader ? { "X-API-Key": apiKeyHeader } : {})
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to update loyalty nudge");
  }
}

export const updateNudgeStatus = serverTelemetry.wrapServerAction(
  "storefront.loyalty.updateNudge",
  updateNudgeStatusImpl,
  { "server.action.feature": "loyalty", "server.action.surface": "storefront" }
);
