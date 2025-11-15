#!/usr/bin/env node

/**
 * Refresh local FX rate snapshot for storefront margin previews.
 * Usage: node tooling/scripts/refresh_fx_rates.mjs
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API = "https://open.er-api.com/v6/latest/USD";
const FX_RATES_API_URL = process.env.FX_RATES_API_URL ?? DEFAULT_API;
const TARGET_SYMBOLS = (process.env.FX_RATES_SYMBOLS ?? "USD,EUR,GBP")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);

if (TARGET_SYMBOLS.length === 0) {
  console.error("No symbols configured via FX_RATES_SYMBOLS.");
  process.exit(1);
}

async function fetchRates() {
  const response = await fetch(FX_RATES_API_URL);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`FX API request failed (${response.status}): ${body}`);
  }
  return response.json();
}

function buildFxTable(basePayload) {
  const rates = { ...(basePayload?.rates ?? {}) };
  rates.USD = rates.USD ?? 1;
  const table = {};
  for (const from of TARGET_SYMBOLS) {
    table[from] = {};
    for (const to of TARGET_SYMBOLS) {
      if (from === to) {
        table[from][to] = 1;
        continue;
      }
      const rate = computeRate(from, to, rates);
      if (rate != null) {
        table[from][to] = Number(rate.toFixed(6));
      }
    }
  }
  return table;
}

function computeRate(from, to, rates) {
  if (from === "USD") {
    const direct = rates[to];
    return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
  }
  const rateFrom = rates[from];
  const rateTo = rates[to];
  if (typeof rateFrom !== "number" || typeof rateTo !== "number" || !Number.isFinite(rateFrom) || !Number.isFinite(rateTo)) {
    return null;
  }
  return rateTo / rateFrom;
}

function resolveTargetPath() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../apps/web/src/data/fx-rates.json");
}

try {
  console.log(`[fx-rates] Fetching FX table from ${FX_RATES_API_URL}`);
  const payload = await fetchRates();
  const table = buildFxTable(payload);
  const targetPath = resolveTargetPath();
  writeFileSync(targetPath, JSON.stringify(table, null, 2));
  const envString = JSON.stringify(table);
  console.log(`[fx-rates] ✅ Updated ${targetPath}`);
  console.log(`[fx-rates] NEXT_PUBLIC_FX_RATES='${envString}'`);
} catch (error) {
  console.error("[fx-rates] ❌ Failed to refresh FX rates:", error);
  process.exit(1);
}
