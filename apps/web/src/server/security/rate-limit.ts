// meta: module: security-rate-limit
type RateLimitBucket = {
  count: number;
  expiresAt: number;
};

type RateLimitOptions = {
  windowMs: number;
  max: number;
};

const globalStore = globalThis as typeof globalThis & {
  __smplatRateLimits?: Map<string, RateLimitBucket>;
};

if (!globalStore.__smplatRateLimits) {
  globalStore.__smplatRateLimits = new Map();
}

const buckets = globalStore.__smplatRateLimits;

// rate-limit-profile: edge-memory-fixed-window
export function consumeRateLimit(identifier: string, options: RateLimitOptions): {
  success: boolean;
  remaining: number;
} {
  const now = Date.now();
  const key = `${identifier}:${Math.floor(now / options.windowMs)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
    return { success: true, remaining: options.max - 1 };
  }

  if (bucket.count >= options.max) {
    return { success: false, remaining: 0 };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return { success: true, remaining: options.max - bucket.count };
}

export function resetRateLimitCache() {
  buckets.clear();
}
