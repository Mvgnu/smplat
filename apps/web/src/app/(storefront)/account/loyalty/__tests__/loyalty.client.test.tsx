import { render, screen, fireEvent } from "@testing-library/react";

import type {
  LoyaltyLedgerPage,
  LoyaltyMemberSummary,
  LoyaltyNextActionFeed,
  LoyaltyNudgeFeed,
  LoyaltyRedemptionPage,
  LoyaltyReward,
  LoyaltyTimelineResult,
  ReferralConversionPage
} from "@smplat/types";

import { LoyaltyHubClient } from "../loyalty.client";
import { StorefrontStateProvider } from "@/context/storefront-state";
import { DEFAULT_STOREFRONT_STATE } from "@/shared/storefront-state";

jest.mock("next/navigation", () => {
  const actual = jest.requireActual("next/navigation");
  return {
    ...actual,
    useRouter: () => ({
      replace: jest.fn(),
      push: jest.fn(),
      prefetch: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn()
    })
  };
});

jest.mock("../loyalty.actions", () => ({
  requestRedemption: jest.fn(async () => ({
    id: "redemption-optimistic",
    memberId: "member-1",
    rewardId: "reward-1",
    status: "requested",
    pointsCost: 300,
    quantity: 1,
    requestedAt: new Date("2024-01-05T00:00:00Z").toISOString(),
    fulfilledAt: null,
    cancelledAt: null,
    failureReason: null
  })),
  updateNudgeStatus: jest.fn(async () => undefined)
}));

const baseMember: LoyaltyMemberSummary = {
  id: "member-1",
  userId: "user-1",
  currentTier: "Silver",
  nextTier: "Gold",
  pointsBalance: 1200,
  pointsOnHold: 0,
  availablePoints: 1200,
  lifetimePoints: 2400,
  progressToNextTier: 0.5,
  referralCode: "rc-123",
  upcomingBenefits: [],
  expiringPoints: []
};

const baseLedger: LoyaltyLedgerPage = {
  entries: [
    {
      id: "ledger-1",
      occurredAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      entryType: "earn",
      amount: 500,
      description: "Referral bonus",
      metadata: { referral_code: "rc-123" },
      balanceBefore: 700,
      balanceAfter: 1200,
      balanceDelta: 500,
      checkoutIntentId: null,
      checkoutOrderId: null
    }
  ],
  nextCursor: null
};

const baseRedemptions: LoyaltyRedemptionPage = {
  redemptions: [
    {
      id: "redemption-1",
      memberId: "member-1",
      rewardId: "reward-1",
      status: "fulfilled",
      pointsCost: 300,
      quantity: 1,
      requestedAt: new Date("2024-01-02T00:00:00Z").toISOString(),
      fulfilledAt: new Date("2024-01-03T00:00:00Z").toISOString(),
      cancelledAt: null,
      failureReason: null
    }
  ],
  nextCursor: null,
  pendingCount: 0
};

const baseReferrals: ReferralConversionPage = {
  invites: [],
  nextCursor: null,
  statusCounts: {},
  convertedPoints: 0,
  lastActivity: null
};

const baseRewards: LoyaltyReward[] = [
  {
    id: "reward-1",
    slug: "strategy-session",
    name: "Strategy Session",
    description: "",
    costPoints: 300,
    isActive: true
  }
];

const baseNextActions: LoyaltyNextActionFeed = { intents: [], cards: [] };

const baseNudges: LoyaltyNudgeFeed = {
  nudges: [
    {
      id: "nudge-1",
      nudgeType: "checkout_reminder",
      headline: "Complete checkout",
      body: "Finish your redemption.",
      ctaLabel: "Resume",
      ctaHref: "/",
      expiresAt: new Date("2024-01-04T00:00:00Z").toISOString(),
      priority: 1,
      metadata: { orderId: "order-42" },
      campaignSlug: "checkout_recovery",
      channels: ["email"],
      status: "acknowledged",
      lastTriggeredAt: new Date("2024-01-03T12:00:00Z").toISOString(),
      acknowledgedAt: new Date("2024-01-03T12:05:00Z").toISOString(),
      dismissedAt: null
    }
  ]
};

const baseTimeline: LoyaltyTimelineResult = {
  entries: [
    {
      kind: "ledger",
      id: "ledger-1",
      occurredAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      ledger: baseLedger.entries[0]
    },
    {
      kind: "redemption",
      id: "redemption-1",
      occurredAt: new Date("2024-01-02T00:00:00Z").toISOString(),
      redemption: baseRedemptions.redemptions[0]
    },
    {
      kind: "referral",
      id: "referral-1",
      occurredAt: new Date("2024-01-02T12:00:00Z").toISOString(),
      referral: {
        id: "referral-1",
        code: "rc-123",
        status: "converted",
        rewardPoints: 500,
        inviteeEmail: "guest@example.com",
        createdAt: new Date("2024-01-01T06:00:00Z").toISOString(),
        updatedAt: new Date("2024-01-02T12:00:00Z").toISOString(),
        completedAt: new Date("2024-01-02T12:00:00Z").toISOString()
      }
    },
    {
      kind: "nudge",
      id: "nudge-1",
      occurredAt: new Date("2024-01-03T12:05:00Z").toISOString(),
      nudge: baseNudges.nudges[0]
    },
    {
      kind: "guardrail_override",
      id: "override-1",
      occurredAt: new Date("2024-01-04T00:00:00Z").toISOString(),
      override: {
        id: "override-1",
        scope: "invite_quota",
        justification: "Peak season",
        metadata: {},
        targetMemberId: null,
        createdByUserId: "operator-1",
        createdAt: new Date("2024-01-04T00:00:00Z").toISOString(),
        expiresAt: new Date("2024-01-05T00:00:00Z").toISOString(),
        revokedAt: null,
        isActive: true
      }
    }
  ],
  cursor: { ledger: null, redemptions: null, referrals: null, nudges: null, guardrails: null },
  cursorToken: null,
  hasMore: false,
  appliedFilters: {
    includeLedger: true,
    includeRedemptions: true,
    includeReferrals: true,
    includeNudges: true,
    includeGuardrails: true,
    ledgerTypes: null,
    redemptionStatuses: null,
    referralStatuses: null,
    nudgeStatuses: null,
    guardrailScopes: null,
    referralCode: null,
    campaignSlug: null,
    checkoutOrderId: null
  }
};

function renderClient(overrides: Partial<React.ComponentProps<typeof LoyaltyHubClient>> = {}) {
  return render(
    <StorefrontStateProvider initialState={DEFAULT_STOREFRONT_STATE}>
      <LoyaltyHubClient
        ledger={baseLedger}
        member={baseMember}
        redemptions={baseRedemptions}
        referrals={baseReferrals}
        rewards={baseRewards}
        nextActions={baseNextActions}
        nudges={baseNudges}
        timeline={baseTimeline}
        csrfToken="token"
        {...overrides}
      />
    </StorefrontStateProvider>
  );
}

test("filters timeline by referral code", () => {
  renderClient();

  expect(screen.getByText(/Guardrail override/)).toBeInTheDocument();

  const referralInput = screen.getByPlaceholderText(/search by code/i);
  fireEvent.change(referralInput, { target: { value: "rc-123" } });

  expect(screen.getByText(/Invite rc-123/)).toBeInTheDocument();
  expect(screen.queryByText(/Guardrail override/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByText(/reset filters/i));
  expect(screen.getByText(/Guardrail override/)).toBeInTheDocument();
});

test("filters timeline by campaign slug", () => {
  renderClient();

  const campaignInput = screen.getByPlaceholderText(/checkout_recovery/i);
  fireEvent.change(campaignInput, { target: { value: "checkout" } });

  expect(screen.getByText(/Nudge acknowledged/)).toBeInTheDocument();
  expect(screen.queryByText(/Invite rc-123/)).not.toBeInTheDocument();
});

test("renders experiment context banner when focus experiment is provided", () => {
  renderClient({ focusExperimentSlug: "checkout_recovery" });

  expect(screen.getByText(/experiment context/i)).toBeInTheDocument();
  expect(screen.getByDisplayValue("checkout_recovery")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /clear experiment focus/i }));
  expect(screen.queryByText(/experiment context/i)).not.toBeInTheDocument();
});
