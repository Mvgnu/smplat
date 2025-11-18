export function extractSummaryNumber(summary: Record<string, unknown> | null | undefined, key: string): number {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const value = summary[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
