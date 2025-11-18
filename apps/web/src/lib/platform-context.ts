export type PlatformContextDescriptor = {
  id?: string | null;
  label?: string | null;
  handle?: string | null;
  platformType?: string | null;
};

export const formatPlatformContextLabel = (
  context: PlatformContextDescriptor | null | undefined
): string => {
  if (!context) {
    return "Platform";
  }
  const base = context.label && context.label.trim().length > 0
    ? context.label
    : context.handle && context.handle.trim().length > 0
      ? context.handle
      : context.platformType && context.platformType.trim().length > 0
        ? context.platformType
        : "Platform";
  const details: string[] = [];
  if (context.handle && context.handle.trim().length > 0 && context.handle !== base) {
    details.push(context.handle);
  }
  if (context.platformType && context.platformType.trim().length > 0 && context.platformType !== base) {
    details.push(context.platformType);
  }
  return details.length ? `${base} • ${details.join(" • ")}` : base;
};
