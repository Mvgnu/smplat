export type SocialPlatformType = "instagram" | "tiktok" | "youtube";

export type SocialAccountVerificationStatus = "pending" | "verified" | "rejected" | "expired";

export type SocialAccountSnapshot = {
  platform: SocialPlatformType;
  handle: string;
  metrics: Record<string, unknown>;
  scrapedAt: string;
  source: string;
  qualityScore: number | null;
  latencyMs: number | null;
  warnings: string[];
  metadata: Record<string, unknown>;
  accountId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
};

export type SocialAccountRecord = {
  id: string;
  platform: SocialPlatformType;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  verificationStatus: SocialAccountVerificationStatus;
  verificationMethod: string | null;
  verificationNotes: string | null;
  lastVerifiedAt: string | null;
  lastScrapedAt: string | null;
  baselineMetrics: Record<string, unknown> | null;
  deliverySnapshots: Record<string, unknown> | null;
  targetMetrics: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  customerProfileId: string | null;
};

export type MetricValidationResult = {
  account: SocialAccountRecord;
  snapshot: SocialAccountSnapshot;
  created: boolean;
};
