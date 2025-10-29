import type {
  LoyaltyLedgerPage,
  LoyaltyMemberSummary,
  LoyaltyRedemptionPage,
  LoyaltyReward,
  ReferralConversionPage
} from "@smplat/types";

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

type LedgerFilters = {
  cursor?: string | null;
  types?: string[];
  limit?: number;
};

export async function fetchLoyaltyLedger(filters: LedgerFilters = {}): Promise<LoyaltyLedgerPage> {
  const params = new URLSearchParams();
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  filters.types?.forEach((value) => params.append("types", value));

  const query = params.toString();
  const url = query
    ? `${apiBase}/api/v1/loyalty/ledger?${query}`
    : `${apiBase}/api/v1/loyalty/ledger`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: apiKeyHeader
      ? {
          "X-API-Key": apiKeyHeader
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Failed to load loyalty ledger: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyLedgerPage;
}

type RedemptionFilters = {
  cursor?: string | null;
  statuses?: string[];
  limit?: number;
};

export async function fetchLoyaltyRedemptions(
  filters: RedemptionFilters = {}
): Promise<LoyaltyRedemptionPage> {
  const params = new URLSearchParams();
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  filters.statuses?.forEach((value) => params.append("statuses", value));

  const query = params.toString();
  const url = query
    ? `${apiBase}/api/v1/loyalty/redemptions?${query}`
    : `${apiBase}/api/v1/loyalty/redemptions`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: apiKeyHeader
      ? {
          "X-API-Key": apiKeyHeader
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Failed to load loyalty redemptions: ${response.statusText}`);
  }

  return (await response.json()) as LoyaltyRedemptionPage;
}

type ReferralConversionFilters = {
  cursor?: string | null;
  statuses?: string[];
  limit?: number;
};

export async function fetchReferralConversions(
  filters: ReferralConversionFilters = {}
): Promise<ReferralConversionPage> {
  const params = new URLSearchParams();
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  filters.statuses?.forEach((value) => params.append("statuses", value));

  const query = params.toString();
  const url = query
    ? `${apiBase}/api/v1/loyalty/referrals/conversions?${query}`
    : `${apiBase}/api/v1/loyalty/referrals/conversions`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: apiKeyHeader
      ? {
          "X-API-Key": apiKeyHeader
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Failed to load referral conversions: ${response.statusText}`);
  }

  return (await response.json()) as ReferralConversionPage;
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

export function buildBypassLedgerPage(): LoyaltyLedgerPage {
  return {
    entries: [
      {
        id: "ledger-1",
        occurredAt: new Date().toISOString(),
        entryType: "earn",
        amount: 500,
        description: "Campaign launch bonus",
        metadata: { source: "campaign" }
      },
      {
        id: "ledger-0",
        occurredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
        entryType: "redeem",
        amount: -250,
        description: "Strategy session redemption",
        metadata: { redemptionId: "demo" }
      }
    ],
    nextCursor: null
  };
}

export function buildBypassRedemptions(): LoyaltyRedemptionPage {
  return {
    redemptions: [
      {
        id: "redeem-1",
        memberId: "00000000-0000-0000-0000-000000000001",
        rewardId: "reward-2",
        status: "fulfilled",
        pointsCost: 1100,
        quantity: 1,
        requestedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
        fulfilledAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
        cancelledAt: null,
        failureReason: null
      },
      {
        id: "redeem-2",
        memberId: "00000000-0000-0000-0000-000000000001",
        rewardId: "reward-1",
        status: "requested",
        pointsCost: 750,
        quantity: 1,
        requestedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        fulfilledAt: null,
        cancelledAt: null,
        failureReason: null
      }
    ],
    nextCursor: null,
    pendingCount: 1
  };
}

export function buildBypassConversions(): ReferralConversionPage {
  return {
    invites: [
      {
        id: "invite-1",
        code: "SHAREME",
        status: "converted",
        rewardPoints: 500,
        inviteeEmail: "converted@example.com",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        completedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString()
      },
      {
        id: "invite-2",
        code: "PENDING",
        status: "sent",
        rewardPoints: 500,
        inviteeEmail: "pending@example.com",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
        completedAt: null
      }
    ],
    nextCursor: null,
    statusCounts: {
      converted: 1,
      sent: 1
    },
    convertedPoints: 500,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
  };
}

export function allowAuthBypass(): boolean {
  return allowBypass;
}
