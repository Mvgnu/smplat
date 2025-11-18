export const STOREFRONT_STATE_COOKIE = "smplat_storefront_state";
export const STOREFRONT_STATE_STORAGE_KEY = "smplat_storefront_state";

export type StorefrontPlatformSelection = {
  id: string;
  label: string;
  handle?: string | null;
  platformType?: string | null;
};

export type StorefrontLoyaltySnapshot = {
  projectedPoints?: number | null;
  tier?: string | null;
  expiresAt?: string | null;
  loyaltyCampaign?: string | null;
  lastUpdatedAt?: string | null;
};

export type StorefrontExperimentExposure = {
  slug: string;
  variantKey: string;
  variantName?: string | null;
  isControl?: boolean | null;
  guardrailStatus?: "healthy" | "warning" | "breached" | null;
  exposedAt?: string | null;
};

export type StorefrontStateSnapshot = {
  platform: StorefrontPlatformSelection | null;
  loyaltySnapshot: StorefrontLoyaltySnapshot | null;
  experimentExposure: StorefrontExperimentExposure | null;
};

export const DEFAULT_STOREFRONT_STATE: StorefrontStateSnapshot = {
  platform: null,
  loyaltySnapshot: null,
  experimentExposure: null,
};

const parseJson = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const sanitizePlatform = (value: unknown): StorefrontPlatformSelection | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : null;
  if (!id) {
    return null;
  }
  const label =
    typeof record.label === "string" && record.label.trim().length > 0 ? record.label.trim() : id;
  return {
    id,
    label,
    handle: typeof record.handle === "string" ? record.handle : null,
    platformType: typeof record.platformType === "string" ? record.platformType : null,
  };
};

const sanitizeLoyaltySnapshot = (value: unknown): StorefrontLoyaltySnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const projectedPoints =
    typeof record.projectedPoints === "number" && Number.isFinite(record.projectedPoints)
      ? record.projectedPoints
      : null;
  const tier =
    typeof record.tier === "string" && record.tier.trim().length > 0 ? record.tier.trim() : null;
  const expiresAt =
    typeof record.expiresAt === "string" && record.expiresAt.trim().length > 0
      ? record.expiresAt.trim()
      : null;
  const loyaltyCampaign =
    typeof record.loyaltyCampaign === "string" && record.loyaltyCampaign.trim().length > 0
      ? record.loyaltyCampaign.trim()
      : null;
  const lastUpdatedAt =
    typeof record.lastUpdatedAt === "string" && record.lastUpdatedAt.trim().length > 0
      ? record.lastUpdatedAt.trim()
      : null;
  if (!projectedPoints && !tier && !expiresAt && !loyaltyCampaign) {
    return null;
  }
  return { projectedPoints, tier, expiresAt, loyaltyCampaign, lastUpdatedAt };
};

const sanitizeExperimentExposure = (value: unknown): StorefrontExperimentExposure | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const slug =
    typeof record.slug === "string" && record.slug.trim().length > 0 ? record.slug.trim() : null;
  const variantKey =
    typeof record.variantKey === "string" && record.variantKey.trim().length > 0
      ? record.variantKey.trim()
      : null;
  if (!slug || !variantKey) {
    return null;
  }
  const variantName =
    typeof record.variantName === "string" && record.variantName.trim().length > 0
      ? record.variantName.trim()
      : null;
  const isControl = typeof record.isControl === "boolean" ? record.isControl : null;
  const guardrailStatus =
    record.guardrailStatus === "healthy" ||
    record.guardrailStatus === "warning" ||
    record.guardrailStatus === "breached"
      ? record.guardrailStatus
      : null;
  const exposedAt =
    typeof record.exposedAt === "string" && record.exposedAt.trim().length > 0
      ? record.exposedAt.trim()
      : null;
  return { slug, variantKey, variantName, isControl, guardrailStatus, exposedAt };
};

export function sanitizeStorefrontSnapshot(
  snapshot: Partial<StorefrontStateSnapshot> | null | undefined
): StorefrontStateSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    return { ...DEFAULT_STOREFRONT_STATE };
  }
  return {
    platform: sanitizePlatform(snapshot.platform ?? null),
    loyaltySnapshot: sanitizeLoyaltySnapshot(snapshot.loyaltySnapshot ?? null),
    experimentExposure: sanitizeExperimentExposure(snapshot.experimentExposure ?? null),
  };
}

export function parseStorefrontState(value: string | null | undefined): StorefrontStateSnapshot {
  if (!value) {
    return { ...DEFAULT_STOREFRONT_STATE };
  }
  const parsed = parseJson(value);
  if (!parsed) {
    return { ...DEFAULT_STOREFRONT_STATE };
  }
  return sanitizeStorefrontSnapshot(parsed as Partial<StorefrontStateSnapshot>);
}

export function serializeStorefrontState(snapshot: StorefrontStateSnapshot): string {
  return JSON.stringify(snapshot);
}

export function mergeStorefrontSnapshots(
  base: StorefrontStateSnapshot,
  override: Partial<StorefrontStateSnapshot> | null | undefined
): StorefrontStateSnapshot {
  const sanitized = sanitizeStorefrontSnapshot(override);
  return {
    platform: sanitized.platform ?? base.platform,
    loyaltySnapshot: sanitized.loyaltySnapshot ?? base.loyaltySnapshot,
    experimentExposure: sanitized.experimentExposure ?? base.experimentExposure,
  };
}
