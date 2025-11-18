export const chartDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export const isoDateKey = (value: Date): string => value.toISOString().slice(0, 10);

export function buildSparklineFromCounts(counts: number[]): string {
  if (counts.length === 0) {
    return "";
  }
  if (counts.length === 1) {
    return "0,20 100,20";
  }
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = max - min || 1;
  return counts
    .map((value, index) => {
      const x = (index / (counts.length - 1)) * 100;
      const normalized = (value - min) / range;
      const y = 40 - normalized * 40;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
