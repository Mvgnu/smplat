import { jest } from "@jest/globals";

import type { LoyaltyTimelineFetchers } from "@/server/loyalty/timeline";

const fetchLoyaltyLedger = jest.fn();
const fetchLoyaltyRedemptions = jest.fn();
const fetchReferralConversions = jest.fn();
const fetchLoyaltyNudgeHistory = jest.fn();
const fetchGuardrailSnapshot = jest.fn();

const originalFetch = globalThis.fetch;

beforeAll(() => {
  (globalThis as any).fetch = jest.fn();
});

afterAll(() => {
  (globalThis as any).fetch = originalFetch;
});

let fetchLoyaltyTimeline: typeof import("@/server/loyalty/timeline").fetchLoyaltyTimeline;
let decodeTimelineCursor: typeof import("@/server/loyalty/timeline").decodeTimelineCursor;
let encodeTimelineCursor: typeof import("@/server/loyalty/timeline").encodeTimelineCursor;
let configureLoyaltyTimelineFetchers: typeof import("@/server/loyalty/timeline").configureLoyaltyTimelineFetchers;
let resetLoyaltyTimelineFetchers: typeof import("@/server/loyalty/timeline").resetLoyaltyTimelineFetchers;

beforeAll(async () => {
  const timelineModule = await import("@/server/loyalty/timeline");
  fetchLoyaltyTimeline = timelineModule.fetchLoyaltyTimeline;
  decodeTimelineCursor = timelineModule.decodeTimelineCursor;
  encodeTimelineCursor = timelineModule.encodeTimelineCursor;
  configureLoyaltyTimelineFetchers = timelineModule.configureLoyaltyTimelineFetchers;
  resetLoyaltyTimelineFetchers = timelineModule.resetLoyaltyTimelineFetchers;
});

describe("fetchLoyaltyTimeline", () => {
  beforeEach(() => {
    fetchLoyaltyLedger.mockReset();
    fetchLoyaltyRedemptions.mockReset();
    fetchReferralConversions.mockReset();
    fetchLoyaltyNudgeHistory.mockReset();
    fetchGuardrailSnapshot.mockReset();

    fetchLoyaltyNudgeHistory.mockResolvedValue({ nudges: [] });
    fetchGuardrailSnapshot.mockResolvedValue({
      inviteQuota: 0,
      totalActiveInvites: 0,
      membersAtQuota: 0,
      cooldownSeconds: 0,
      cooldownRemainingSeconds: null,
      cooldownUntil: null,
      throttleOverrideActive: false,
      overrides: []
    });

    configureLoyaltyTimelineFetchers({
      fetchLoyaltyLedger: fetchLoyaltyLedger as LoyaltyTimelineFetchers["fetchLoyaltyLedger"],
      fetchLoyaltyRedemptions:
        fetchLoyaltyRedemptions as LoyaltyTimelineFetchers["fetchLoyaltyRedemptions"],
      fetchReferralConversions:
        fetchReferralConversions as LoyaltyTimelineFetchers["fetchReferralConversions"],
      fetchLoyaltyNudgeHistory:
        fetchLoyaltyNudgeHistory as LoyaltyTimelineFetchers["fetchLoyaltyNudgeHistory"],
      fetchGuardrailSnapshot:
        fetchGuardrailSnapshot as LoyaltyTimelineFetchers["fetchGuardrailSnapshot"]
    });
  });

  afterEach(() => {
    resetLoyaltyTimelineFetchers();
  });

  it("merges ledger and redemption entries chronologically", async () => {
    fetchLoyaltyLedger.mockResolvedValue({
      entries: [
        {
          id: "ledger-new",
          occurredAt: "2024-03-05T12:00:00Z",
          entryType: "earn",
          amount: 60,
          description: "Campaign bonus",
          metadata: {},
          balanceAfter: 160
        },
        {
          id: "ledger-old",
          occurredAt: "2024-03-01T09:30:00Z",
          entryType: "earn",
          amount: 100,
          description: "Signup bonus",
          metadata: {},
          balanceAfter: 100
        }
      ],
      nextCursor: null
    });
    fetchLoyaltyRedemptions.mockResolvedValue({
      redemptions: [
        {
          id: "redemption-one",
          memberId: "member-1",
          rewardId: "reward-1",
          status: "fulfilled",
          pointsCost: 40,
          quantity: 1,
          requestedAt: "2024-03-03T10:00:00Z",
          fulfilledAt: "2024-03-04T11:00:00Z",
          cancelledAt: null,
          failureReason: null
        }
      ],
      nextCursor: null,
      pendingCount: 0
    });
    fetchReferralConversions.mockResolvedValue({
      invites: [],
      nextCursor: null,
      statusCounts: {},
      convertedPoints: 0,
      lastActivity: null
    });

    const result = await fetchLoyaltyTimeline({ limit: 5 });

    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((entry) => `${entry.kind}-${entry.id}`)).toEqual([
      "ledger-ledger-new",
      "redemption-redemption-one",
      "ledger-ledger-old"
    ]);
    expect(result.cursor).toEqual({
      ledger: null,
      redemptions: null,
      referrals: null,
      nudges: null,
      guardrails: null
    });
    expect(decodeTimelineCursor(result.cursorToken)).toEqual(result.cursor);
  });

  it("reports pagination state across multiple windows", async () => {
    fetchLoyaltyLedger.mockImplementation(async ({ cursor }) => {
      if (!cursor) {
        return {
          entries: [
            {
              id: "ledger-3",
              occurredAt: "2024-03-06T12:00:00Z",
              entryType: "earn",
              amount: 30,
              description: "Referral bonus",
              metadata: {},
              balanceAfter: 190
            },
            {
              id: "ledger-2",
              occurredAt: "2024-03-05T12:00:00Z",
              entryType: "earn",
              amount: 60,
              description: "Campaign bonus",
              metadata: {},
              balanceAfter: 160
            }
          ],
          nextCursor: "ledger-cursor-1"
        };
      }
      return {
        entries: [
          {
            id: "ledger-1",
            occurredAt: "2024-03-01T09:30:00Z",
            entryType: "earn",
            amount: 100,
            description: "Signup bonus",
            metadata: {},
            balanceAfter: 100
          }
        ],
        nextCursor: null
      };
    });
    fetchLoyaltyRedemptions.mockResolvedValue({ redemptions: [], nextCursor: null, pendingCount: 0 });
    fetchReferralConversions.mockResolvedValue({
      invites: [],
      nextCursor: null,
      statusCounts: {},
      convertedPoints: 0,
      lastActivity: null
    });

    const firstPage = await fetchLoyaltyTimeline({ limit: 2 });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await fetchLoyaltyTimeline({
      limit: 2,
      cursor: firstPage.cursorToken
    });
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.entries[0].id).toBe("ledger-1");
  });

  it("encodes and decodes timeline cursors", () => {
    const cursor = {
      ledger: "cursor-ledger",
      redemptions: "cursor-redemption",
      referrals: null,
      nudges: "cursor-nudges",
      guardrails: null
    };
    const token = encodeTimelineCursor(cursor);
    expect(token).not.toBeNull();
    expect(decodeTimelineCursor(token)).toEqual(cursor);
  });

  it("includes nudge and guardrail entries when present", async () => {
    fetchLoyaltyLedger.mockResolvedValue({ entries: [], nextCursor: null });
    fetchLoyaltyRedemptions.mockResolvedValue({ redemptions: [], nextCursor: null, pendingCount: 0 });
    fetchReferralConversions.mockResolvedValue({
      invites: [],
      nextCursor: null,
      statusCounts: {},
      convertedPoints: 0,
      lastActivity: null
    });
    fetchLoyaltyNudgeHistory.mockResolvedValue({
      nudges: [
        {
          id: "nudge-1",
          nudgeType: "checkout_reminder",
          headline: "Complete your checkout",
          body: "You have items waiting to be confirmed.",
          ctaLabel: "Resume checkout",
          ctaHref: "/checkout/resume",
          expiresAt: null,
          priority: 1,
          metadata: { intentId: "intent-1" },
          campaignSlug: "launch",
          channels: ["email"],
          status: "SENT",
          lastTriggeredAt: "2024-03-07T15:00:00Z",
          acknowledgedAt: "2024-03-07T16:00:00Z",
          dismissedAt: null
        }
      ]
    });
    fetchGuardrailSnapshot.mockResolvedValue({
      inviteQuota: 10,
      totalActiveInvites: 2,
      membersAtQuota: 1,
      cooldownSeconds: 3600,
      cooldownRemainingSeconds: 1200,
      cooldownUntil: "2024-03-07T18:00:00Z",
      throttleOverrideActive: false,
      overrides: [
        {
          id: "override-1",
          scope: "invite_quota",
          justification: "VIP concierge",
          metadata: {},
          targetMemberId: "member-123",
          createdByUserId: "user-456",
          createdAt: "2024-03-07T14:30:00Z",
          expiresAt: null,
          revokedAt: null,
          isActive: true
        }
      ]
    });

    const result = await fetchLoyaltyTimeline({ limit: 5 });

    expect(result.entries.some((entry) => entry.kind === "nudge")).toBe(true);
    expect(result.entries.some((entry) => entry.kind === "guardrail_override")).toBe(true);
  });
});
