import type {
  ReferralInviteCancelPayload,
  ReferralInviteCreatePayload,
  ReferralInviteResponse
} from "@smplat/types";

import {
  cancelStubReferral,
  issueStubReferral,
  listStubReferrals
} from "./referrals.stub";

const apiBase =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";

function buildSessionHeaders(userId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Session-User": userId
  };
}

export async function fetchMemberReferrals(userId: string): Promise<ReferralInviteResponse[]> {
  if (allowBypass) {
    return listStubReferrals();
  }

  const response = await fetch(`${apiBase}/api/v1/loyalty/referrals`, {
    cache: "no-store",
    headers: buildSessionHeaders(userId)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load referral invites");
  }

  return (await response.json()) as ReferralInviteResponse[];
}

export async function createMemberReferral(
  userId: string,
  payload: ReferralInviteCreatePayload
): Promise<ReferralInviteResponse> {
  if (allowBypass) {
    return issueStubReferral({ inviteeEmail: payload.inviteeEmail ?? null });
  }

  const response = await fetch(`${apiBase}/api/v1/loyalty/referrals`, {
    method: "POST",
    headers: buildSessionHeaders(userId),
    body: JSON.stringify({
      inviteeEmail: payload.inviteeEmail ?? null,
      metadata: payload.metadata ?? {}
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create referral invite");
  }

  return (await response.json()) as ReferralInviteResponse;
}

export async function cancelMemberReferral(
  userId: string,
  referralId: string,
  payload: ReferralInviteCancelPayload = {}
): Promise<ReferralInviteResponse> {
  if (allowBypass) {
    return cancelStubReferral(referralId);
  }

  const response = await fetch(`${apiBase}/api/v1/loyalty/referrals/${referralId}/cancel`, {
    method: "POST",
    headers: buildSessionHeaders(userId),
    body: JSON.stringify({
      reason: payload.reason ?? null
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to cancel referral invite");
  }

  return (await response.json()) as ReferralInviteResponse;
}
