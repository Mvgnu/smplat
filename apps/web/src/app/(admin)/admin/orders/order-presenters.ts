export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  active: "Active",
  completed: "Completed",
  on_hold: "On Hold",
  canceled: "Canceled"
};

export const ORDER_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-200 border border-amber-400/30",
  processing: "bg-blue-500/10 text-blue-200 border border-blue-400/30",
  active: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/30",
  completed: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/30",
  on_hold: "bg-orange-500/10 text-orange-200 border border-orange-400/30",
  canceled: "bg-rose-500/10 text-rose-200 border border-rose-400/30"
};

export const ORDER_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatOrderCurrency(
  value: number,
  currency: string,
  { minimumFractionDigits = 2, maximumFractionDigits = 2 }: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
}
