import { randomUUID } from "node:crypto";

import type { ReferralInviteResponse } from "@smplat/types";

const STUB_REWARD_POINTS = 500;
const STUB_MAX_ACTIVE = 3;
const STUB_COOLDOWN_MS = 4_000;

let stubReferrals: ReferralInviteResponse[] = [];

export function listStubReferrals(): ReferralInviteResponse[] {
  return [...stubReferrals];
}

export function issueStubReferral(payload: { inviteeEmail?: string | null }): ReferralInviteResponse {
  const now = Date.now();
  const activeCount = stubReferrals.filter((referral) => referral.status === "draft" || referral.status === "sent").length;
  if (activeCount >= STUB_MAX_ACTIVE) {
    throw new Error("Referral invite limit reached");
  }

  const latest = stubReferrals[0];
  if (latest) {
    const createdAtMs = Date.parse(latest.createdAt);
    if (!Number.isNaN(createdAtMs) && now - createdAtMs < STUB_COOLDOWN_MS) {
      throw new Error("Please wait before sending another invite");
    }
  }

  const referral: ReferralInviteResponse = {
    id: randomUUID(),
    code: `STUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    status: "sent",
    rewardPoints: STUB_REWARD_POINTS,
    inviteeEmail: payload.inviteeEmail ?? null,
    createdAt: new Date(now).toISOString(),
    expiresAt: null,
    completedAt: null
  };

  stubReferrals = [referral, ...stubReferrals];
  return referral;
}

export function cancelStubReferral(referralId: string): ReferralInviteResponse {
  const referral = stubReferrals.find((item) => item.id === referralId);
  if (!referral) {
    throw new Error("Referral invite not found");
  }

  if (referral.status === "converted" || referral.status === "cancelled") {
    return referral;
  }

  const updated: ReferralInviteResponse = {
    ...referral,
    status: "cancelled"
  };

  stubReferrals = stubReferrals.map((item) => (item.id === referralId ? updated : item));
  return updated;
}

export function resetStubReferrals() {
  stubReferrals = [];
}
