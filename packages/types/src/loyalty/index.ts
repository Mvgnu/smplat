export interface LoyaltyTier {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  pointThreshold: number;
  benefits: unknown[];
  isActive: boolean;
}

export interface LoyaltyMemberSummary {
  id: string;
  userId: string;
  currentTier?: string | null;
  nextTier?: string | null;
  pointsBalance: number;
  pointsOnHold: number;
  availablePoints: number;
  lifetimePoints: number;
  progressToNextTier: number;
  referralCode?: string | null;
  upcomingBenefits: unknown[];
  expiringPoints: LoyaltyPointsExpiration[];
}

export interface ReferralInviteResponse {
  id: string;
  code: string;
  status: string;
  rewardPoints: number;
  inviteeEmail?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  completedAt?: string | null;
}

export interface ReferralInviteCreatePayload {
  inviteeEmail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReferralInviteCancelPayload {
  reason?: string | null;
}

export interface LoyaltyPointsExpiration {
  expiresAt: string;
  points: number;
  remainingPoints: number;
  status: string;
}

export interface LoyaltyReward {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  costPoints: number;
  isActive: boolean;
}

export interface LoyaltyRedemption {
  id: string;
  memberId: string;
  rewardId?: string | null;
  status: string;
  pointsCost: number;
  quantity: number;
  requestedAt: string;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
  failureReason?: string | null;
}

export interface LoyaltyLedgerEntry {
  id: string;
  occurredAt: string;
  entryType: string;
  amount: number;
  description?: string | null;
  metadata: Record<string, unknown>;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  balanceDelta?: number | null;
  checkoutIntentId?: string | null;
  checkoutOrderId?: string | null;
}

export interface LoyaltyLedgerPage {
  entries: LoyaltyLedgerEntry[];
  nextCursor?: string | null;
}

export interface LoyaltyRedemptionPage {
  redemptions: LoyaltyRedemption[];
  nextCursor?: string | null;
  pendingCount: number;
}

export interface ReferralConversion {
  id: string;
  code: string;
  status: string;
  rewardPoints: number;
  inviteeEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface ReferralConversionPage {
  invites: ReferralConversion[];
  nextCursor?: string | null;
  statusCounts: Record<string, number>;
  convertedPoints: number;
  lastActivity?: string | null;
}

export type LoyaltyCheckoutIntentKind = "redemption" | "referral_share";
export type LoyaltyCheckoutIntentStatus =
  | "pending"
  | "resolved"
  | "cancelled"
  | "expired";

export interface LoyaltyCheckoutIntent {
  id: string;
  clientIntentId: string;
  kind: LoyaltyCheckoutIntentKind;
  status: LoyaltyCheckoutIntentStatus;
  createdAt: string;
  orderId?: string | null;
  channel?: string | null;
  rewardSlug?: string | null;
  rewardName?: string | null;
  pointsCost?: number | null;
  quantity?: number | null;
  referralCode?: string | null;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LoyaltyIntentConfirmationPayload {
  orderId: string;
  userId: string;
  intents: Array<
    Omit<
      LoyaltyCheckoutIntent,
      "id" | "status" | "clientIntentId" | "resolvedAt" | "metadata"
    > & {
      id: string;
      metadata?: Record<string, unknown>;
    }
  >;
  action: "confirm" | "cancel";
}

export interface LoyaltyNextActionCard {
  id: string;
  kind: LoyaltyCheckoutIntentKind;
  headline: string;
  description: string;
  ctaLabel: string;
  createdAt: string;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LoyaltyNextActionFeed {
  intents: LoyaltyCheckoutIntent[];
  cards: LoyaltyNextActionCard[];
}

export type LoyaltyNudgeType =
  | "expiring_points"
  | "checkout_reminder"
  | "redemption_follow_up";

export interface LoyaltyNudgeCard {
  id: string;
  nudgeType: LoyaltyNudgeType;
  headline: string;
  body: string;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  expiresAt?: string | null;
  priority: number;
  metadata: Record<string, unknown>;
  campaignSlug?: string | null;
  channels: string[];
  status: string;
  lastTriggeredAt?: string | null;
  acknowledgedAt?: string | null;
  dismissedAt?: string | null;
}

export interface LoyaltyNudgeFeed {
  nudges: LoyaltyNudgeCard[];
}

export type LoyaltyGuardrailOverrideScope =
  | 'invite_quota'
  | 'invite_cooldown'
  | 'global_throttle';

export interface LoyaltyGuardrailOverride {
  id: string;
  scope: LoyaltyGuardrailOverrideScope;
  justification: string;
  metadata: Record<string, unknown>;
  targetMemberId?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  isActive: boolean;
}

export interface LoyaltyGuardrailSnapshot {
  inviteQuota: number;
  totalActiveInvites: number;
  membersAtQuota: number;
  cooldownSeconds: number;
  cooldownRemainingSeconds?: number | null;
  cooldownUntil?: string | null;
  throttleOverrideActive: boolean;
  overrides: LoyaltyGuardrailOverride[];
}

export type LoyaltySegmentSlug = "active" | "stalled" | "at-risk" | "inactive";

export interface LoyaltySegmentSummary {
  slug: LoyaltySegmentSlug;
  label: string;
  memberCount: number;
  averageInvitesPerMember: number;
  averageConversionsPerMember: number;
  averagePointsEarnedPerMember: number;
}

export interface LoyaltySegmentsSnapshot {
  computedAt: string;
  windowDays: number;
  segments: LoyaltySegmentSummary[];
}

export interface LoyaltyVelocitySnapshot {
  computedAt: string;
  windowDays: number;
  totalInvites: number;
  totalConversions: number;
  totalPointsEarned: number;
  invitesPerMember: number;
  conversionsPerMember: number;
  pointsPerMember: number;
}

export interface LoyaltyVelocityTimeline {
  snapshots: LoyaltyVelocitySnapshot[];
  nextCursor?: string | null;
}

export type LoyaltyTimelineEntryKind =
  | 'ledger'
  | 'redemption'
  | 'referral'
  | 'nudge'
  | 'guardrail_override';

export type LoyaltyTimelineLedgerEntry = {
  kind: 'ledger';
  id: string;
  occurredAt: string;
  ledger: LoyaltyLedgerEntry;
};

export type LoyaltyTimelineRedemptionEntry = {
  kind: 'redemption';
  id: string;
  occurredAt: string;
  redemption: LoyaltyRedemption;
};

export type LoyaltyTimelineReferralEntry = {
  kind: 'referral';
  id: string;
  occurredAt: string;
  referral: ReferralConversion;
};

export type LoyaltyTimelineNudgeEntry = {
  kind: 'nudge';
  id: string;
  occurredAt: string;
  nudge: LoyaltyNudgeCard;
};

export type LoyaltyTimelineGuardrailEntry = {
  kind: 'guardrail_override';
  id: string;
  occurredAt: string;
  override: LoyaltyGuardrailOverride;
};

export type LoyaltyTimelineEntry =
  | LoyaltyTimelineLedgerEntry
  | LoyaltyTimelineRedemptionEntry
  | LoyaltyTimelineReferralEntry
  | LoyaltyTimelineNudgeEntry
  | LoyaltyTimelineGuardrailEntry;

export type LoyaltyTimelineFilters = {
  includeLedger?: boolean;
  includeRedemptions?: boolean;
  includeReferrals?: boolean;
  includeNudges?: boolean;
  includeGuardrails?: boolean;
  ledgerTypes?: string[];
  redemptionStatuses?: string[];
  referralStatuses?: string[];
  nudgeStatuses?: string[];
  guardrailScopes?: LoyaltyGuardrailOverrideScope[];
  referralCode?: string | null;
  campaignSlug?: string | null;
  checkoutOrderId?: string | null;
};

export type LoyaltyTimelineCursor = {
  ledger: string | null;
  redemptions: string | null;
  referrals: string | null;
  nudges: string | null;
  guardrails: string | null;
};

export type LoyaltyTimelinePage = {
  entries: LoyaltyTimelineEntry[];
  cursor: LoyaltyTimelineCursor;
  hasMore: boolean;
  appliedFilters: Required<LoyaltyTimelineFilters> & {
    ledgerTypes: string[] | null;
    redemptionStatuses: string[] | null;
    referralStatuses: string[] | null;
    nudgeStatuses: string[] | null;
    guardrailScopes: LoyaltyGuardrailOverrideScope[] | null;
  };
};
