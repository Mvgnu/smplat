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
  pointsBalance: number;
  lifetimePoints: number;
  referralCode?: string | null;
}

export interface ReferralInviteResponse {
  id: string;
  code: string;
  status: string;
  rewardPoints: number;
  inviteeEmail?: string | null;
}
