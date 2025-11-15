import fxRateSnapshot from "@/data/fx-rates.json";

export type FxRateTable = Record<string, Record<string, number>>;

const FALLBACK_FX_RATES: FxRateTable = {
  USD: { USD: 1, EUR: 0.92, GBP: 0.79 },
  EUR: { EUR: 1, USD: 1.09, GBP: 0.86 },
  GBP: { GBP: 1, USD: 1.27, EUR: 1.16 },
};

const RAW_FX_RATES = process.env.NEXT_PUBLIC_FX_RATES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeFxRateTable(payload: unknown): FxRateTable | null {
  if (!isRecord(payload)) {
    return null;
  }
  const table: FxRateTable = {};
  for (const [from, toMap] of Object.entries(payload)) {
    if (!isRecord(toMap)) {
      continue;
    }
    const fromCode = from.trim().toUpperCase();
    if (!fromCode) {
      continue;
    }
    const inner: Record<string, number> = {};
    for (const [to, rate] of Object.entries(toMap)) {
      const toCode = to.trim().toUpperCase();
      const numericRate = typeof rate === "number" && Number.isFinite(rate) ? rate : null;
      if (!toCode || numericRate == null || numericRate <= 0) {
        continue;
      }
      inner[toCode] = numericRate;
    }
    if (!inner[fromCode]) {
      inner[fromCode] = 1;
    }
    if (Object.keys(inner).length > 0) {
      table[fromCode] = inner;
    }
  }
  return Object.keys(table).length > 0 ? table : null;
}

const FILE_FX_RATES = (fxRateSnapshot ?? null) as FxRateTable | null;

const parsedFxRates = (() => {
  if (!RAW_FX_RATES) {
    return null;
  }
  try {
    return normalizeFxRateTable(JSON.parse(RAW_FX_RATES));
  } catch {
    return null;
  }
})();

export const FX_RATE_TABLE: FxRateTable = parsedFxRates ?? FILE_FX_RATES ?? FALLBACK_FX_RATES;
