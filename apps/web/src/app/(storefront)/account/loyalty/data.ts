import type { LoyaltyMemberSummary, LoyaltyReward } from "@smplat/types";

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiKeyHeader = process.env.CHECKOUT_API_KEY || process.env.NEXT_PUBLIC_CHECKOUT_API_KEY;
const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";

export async function fetchLoyaltyMember(userId: string): Promise<LoyaltyMemberSummary> {
  const response = await fetch(`${apiBase}/api/v1/loyalty/members/${userId}`, {
    cache: "no-store",
    headers: apiKeyHeader
      ? {
          "X-API-Key": apiKeyHeader
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Failed to load loyalty member: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyMemberSummary;
}

export async function fetchLoyaltyRewards(): Promise<LoyaltyReward[]> {
  const response = await fetch(`${apiBase}/api/v1/loyalty/rewards`, {
    cache: "no-store",
    headers: apiKeyHeader
      ? {
          "X-API-Key": apiKeyHeader
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Failed to load rewards: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyReward[];
}

export function buildBypassMember(): LoyaltyMemberSummary {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000001",
    currentTier: "Bronze",
    nextTier: "Silver",
    pointsBalance: 1250,
    pointsOnHold: 0,
    availablePoints: 1250,
    lifetimePoints: 2200,
    progressToNextTier: 0.45,
    referralCode: "E2E-BYPASS",
    upcomingBenefits: [],
    expiringPoints: []
  };
}

export function buildBypassRewards(): LoyaltyReward[] {
  return [
    {
      id: "reward-1",
      slug: "social-boost",
      name: "Social Boost",
      description: "Priority slotting for next campaign",
      costPoints: 750,
      isActive: true
    },
    {
      id: "reward-2",
      slug: "strategy-session",
      name: "Strategy Session",
      description: "30 minute strategy workshop with a specialist",
      costPoints: 1100,
      isActive: true
    }
  ];
}

export function allowAuthBypass(): boolean {
  return allowBypass;
}
