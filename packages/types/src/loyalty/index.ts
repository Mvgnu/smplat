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
