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
