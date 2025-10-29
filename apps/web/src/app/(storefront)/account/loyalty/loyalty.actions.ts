"use server";

import type {
  LoyaltyRedemption,
  ReferralInviteCancelPayload,
  ReferralInviteCreatePayload,
  ReferralInviteResponse
} from "@smplat/types";

import { auth } from "@/server/auth";
import {
  cancelMemberReferral,
  createMemberReferral
} from "@/lib/loyalty/referrals";

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY || process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";
const bypassUserId = "00000000-0000-0000-0000-000000000001";

export type RedemptionRequestPayload = {
  rewardSlug?: string;
  pointsCost?: number;
  quantity?: number;
  metadata?: Record<string, unknown>;
};

export async function requestRedemption(payload: RedemptionRequestPayload): Promise<LoyaltyRedemption> {
  const session = await auth();
  if (!session?.user?.id) {
    if (allowBypass) {
      return buildBypassRedemption(payload.rewardSlug ?? "reward-1");
    }
    throw new Error("Authentication is required to redeem rewards.");
  }

  if (allowBypass) {
    return buildBypassRedemption(payload.rewardSlug ?? "reward-1");
  }

  const body = {
    rewardSlug: payload.rewardSlug,
    pointsCost: payload.pointsCost,
    quantity: payload.quantity ?? 1,
    metadata: payload.metadata ?? {}
  };

  const response = await fetch(`${apiBase}/api/v1/loyalty/members/${session.user.id}/redemptions`, {
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

export async function issueReferralInvite(
  payload: ReferralInviteCreatePayload
): Promise<ReferralInviteResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    if (allowBypass) {
      return createMemberReferral(bypassUserId, payload);
    }
    throw new Error("Authentication is required to issue referrals.");
  }

  try {
    return await createMemberReferral(session.user.id, payload);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Failed to create referral invite");
  }
}

export async function cancelReferralInvite(
  referralId: string,
  payload: ReferralInviteCancelPayload = {}
): Promise<ReferralInviteResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    if (allowBypass) {
      return cancelMemberReferral(bypassUserId, referralId, payload);
    }
    throw new Error("Authentication is required to manage referrals.");
  }

  try {
    return await cancelMemberReferral(session.user.id, referralId, payload);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Failed to cancel referral invite");
  }
}

export type LoyaltyNudgeStatus = "active" | "acknowledged" | "dismissed";

export async function updateNudgeStatus(
  nudgeId: string,
  status: LoyaltyNudgeStatus
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    if (allowBypass) {
      return;
    }
    throw new Error("Authentication is required to manage nudges.");
  }

  if (allowBypass) {
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
