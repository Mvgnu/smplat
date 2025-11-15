const rawFlags = (process.env.NEXT_PUBLIC_FEATURE_FLAGS ?? "")
  .split(",")
  .map((flag) => flag.trim().toLowerCase())
  .filter((flag) => flag.length > 0);

const featureFlagSet = new Set(rawFlags);

export function isFeatureFlagEnabled(flagKey?: string | null): boolean {
  if (!flagKey) {
    return true;
  }
  return featureFlagSet.has(flagKey.trim().toLowerCase());
}
