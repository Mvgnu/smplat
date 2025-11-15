import type {
  FulfillmentProviderOrder,
  FulfillmentProviderOrderReplayEntry,
  FulfillmentProviderRuleMetadataMap,
} from "@/types/fulfillment";
import type {
  ProviderServiceCadence,
  ProviderServiceCostModel,
  ProviderServiceCostTier,
  ProviderServiceGuardrails,
} from "@smplat/types";
import type { ServiceOverrideRule } from "@smplat/types";

export type MarginStatus = "idle" | "pass" | "warn" | "fail";

type GuardrailTelemetrySummary = {
  evaluated: number;
  pass: number;
  warn: number;
  fail: number;
};

type ReplayTelemetrySummary = {
  total: number;
  executed: number;
  failed: number;
  scheduled: number;
};

type RuleOverrideStat = {
  id: string;
  label: string | null;
  count: number;
};

export type RuleOverrideServiceSummary = {
  totalOverrides: number;
  rules: Record<string, RuleOverrideStat>;
};

export type ProviderAutomationTelemetry = {
  totalOrders: number;
  replays: ReplayTelemetrySummary;
  guardrails: GuardrailTelemetrySummary;
  guardrailHitsByService: Record<string, GuardrailTelemetrySummary>;
  ruleOverridesByService: Record<string, RuleOverrideServiceSummary>;
};

export type ProviderOrderMarginInsight = {
  status: MarginStatus;
  marginValue: number | null;
  marginPercent: number | null;
  providerCost: number | null;
  customerPrice: number | null;
  guardrails?: ProviderServiceGuardrails;
};

export function buildReplayRuleMetadata(
  entry: FulfillmentProviderOrderReplayEntry | null | undefined,
): ServiceOverrideRule[] {
  if (!entry) {
    return [];
  }
  const ruleIds = Array.isArray(entry.ruleIds) ? entry.ruleIds : [];
  if (!ruleIds.length) {
    return [];
  }
  const metadataMap = sanitizeRuleMetadata(entry.ruleMetadata);
  return ruleIds.map((ruleId) => metadataMap[ruleId] ?? createFallbackRule(ruleId));
}

export function safePositiveNumber(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function estimateProviderCost(
  costModel: ProviderServiceCostModel | null | undefined,
  quantity: number | null | undefined,
): number | null {
  if (!costModel) {
    return null;
  }
  const normalizedQuantity = typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(quantity, 0) : 0;
  if (costModel.kind === "flat") {
    return costModel.amount;
  }
  if (costModel.kind === "per_unit") {
    const units = Math.max(normalizedQuantity, costModel.minimumUnits ?? 0);
    return units * costModel.unitAmount;
  }
  if (costModel.kind === "tiered") {
    return computeTieredCost(costModel.tiers, normalizedQuantity);
  }
  return null;
}

export function evaluateMargin(
  guardrails: ProviderServiceGuardrails | null | undefined,
  providerCost: number | null | undefined,
  customerPrice: number | null | undefined,
): { status: MarginStatus; marginValue: number | null; marginPercent: number | null } {
  if (
    providerCost == null ||
    !Number.isFinite(providerCost) ||
    customerPrice == null ||
    !Number.isFinite(customerPrice) ||
    customerPrice <= 0
  ) {
    return { status: "idle", marginValue: null, marginPercent: null };
  }
  const marginValue = customerPrice - providerCost;
  const marginPercent = (marginValue / customerPrice) * 100;
  let status: MarginStatus = "pass";
  if (guardrails) {
    if (
      (typeof guardrails.minimumMarginAbsolute === "number" &&
        marginValue < guardrails.minimumMarginAbsolute) ||
      (typeof guardrails.minimumMarginPercent === "number" && marginPercent < guardrails.minimumMarginPercent)
    ) {
      status = "fail";
    } else if (
      typeof guardrails.warningMarginPercent === "number" &&
      marginPercent < guardrails.warningMarginPercent
    ) {
      status = "warn";
    }
  }
  return { status, marginValue, marginPercent };
}

export function describeCostModel(
  costModel: ProviderServiceCostModel | null | undefined,
  currency: string,
): string[] {
  if (!costModel) {
    return [];
  }
  if (costModel.kind === "flat") {
    return [`${formatCurrency(costModel.amount, currency)} per order`];
  }
  if (costModel.kind === "per_unit") {
    const unitLabel = costModel.unit ? ` per ${costModel.unit}` : " per unit";
    const minimum =
      typeof costModel.minimumUnits === "number" && costModel.minimumUnits > 0
        ? ` · minimum ${costModel.minimumUnits} units`
        : "";
    return [`${formatCurrency(costModel.unitAmount, currency)}${unitLabel}${minimum}`];
  }
  if (costModel.kind === "tiered") {
    const tiers = costModel.tiers
      .map((tier) => {
        const range = tier.upTo ? `≤ ${tier.upTo}` : "∞";
        return `${range}: ${formatCurrency(tier.unitAmount, currency)} per unit`;
      })
      .slice(0, 3);
    return [`Tiered pricing (${costModel.tiers.length} bands)`, ...tiers];
  }
  return [];
}

export function describeCadence(cadence: ProviderServiceCadence | null | undefined): string[] {
  if (!cadence) {
    return [];
  }
  const lines: string[] = [];
  if (typeof cadence.batchSize === "number") {
    lines.push(`Batch size ${cadence.batchSize}`);
  }
  if (typeof cadence.defaultDailyQuota === "number") {
    lines.push(`${cadence.defaultDailyQuota} / day`);
  }
  if (typeof cadence.fulfillmentWindowHours === "number") {
    lines.push(`Fulfillment window ~${cadence.fulfillmentWindowHours}h`);
  }
  if (typeof cadence.expectedCompletionHours === "number") {
    lines.push(`Expected completion ~${cadence.expectedCompletionHours}h`);
  }
  if (typeof cadence.refillWindowHours === "number") {
    lines.push(`Refill buffer ${cadence.refillWindowHours}h`);
  }
  if (cadence.notes) {
    lines.push(cadence.notes);
  }
  return lines;
}

export function describeGuardrails(
  guardrails: ProviderServiceGuardrails | null | undefined,
  currency: string,
): string[] {
  if (!guardrails) {
    return [];
  }
  const lines: string[] = [];
  if (typeof guardrails.minimumMarginPercent === "number") {
    lines.push(`Minimum margin ${guardrails.minimumMarginPercent.toFixed(1)}%`);
  }
  if (typeof guardrails.warningMarginPercent === "number") {
    lines.push(`Warn below ${guardrails.warningMarginPercent.toFixed(1)}%`);
  }
  if (typeof guardrails.minimumMarginAbsolute === "number") {
    lines.push(`Hard floor ${formatCurrency(guardrails.minimumMarginAbsolute, currency)}`);
  }
  if (guardrails.notes) {
    lines.push(guardrails.notes);
  }
  return lines;
}

export function formatCurrency(amount: number, currency?: string | null): string {
  const fallback = currency ?? "USD";
  if (!Number.isFinite(amount)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: fallback,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${fallback} ${amount.toFixed(2)}`;
  }
}

function computeTieredCost(tiers: ProviderServiceCostTier[], quantity: number): number | null {
  if (!Array.isArray(tiers) || !tiers.length || quantity <= 0) {
    return null;
  }
  const sorted = [...tiers].sort(
    (a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY),
  );
  let remaining = quantity;
  let consumed = 0;
  let total = 0;
  for (const tier of sorted) {
    const cap = tier.upTo ?? Number.POSITIVE_INFINITY;
    const tierWindow = Math.min(Math.max(cap - consumed, 0), remaining);
    if (tierWindow > 0) {
      total += tierWindow * tier.unitAmount;
      remaining -= tierWindow;
      consumed += tierWindow;
    }
    if (remaining <= 0) {
      break;
    }
  }
  if (remaining > 0) {
    const lastTier = sorted.at(-1);
    if (!lastTier) {
      return null;
    }
    total += remaining * lastTier.unitAmount;
  }
  return total;
}

export function summarizeProviderAutomationTelemetry(
  orders: FulfillmentProviderOrder[] | null | undefined,
): ProviderAutomationTelemetry {
  const summary: ProviderAutomationTelemetry = {
    totalOrders: 0,
    replays: createReplaySummary(),
    guardrails: createGuardrailSummary(),
    guardrailHitsByService: {},
    ruleOverridesByService: {},
  };
  if (!Array.isArray(orders) || orders.length === 0) {
    return summary;
  }
  summary.totalOrders = orders.length;
  for (const order of orders) {
    const replays = Array.isArray(order.replays) ? order.replays : [];
    summary.replays.total += replays.length;
    for (const replay of replays) {
      if (replay.status === "executed") {
        summary.replays.executed += 1;
      } else if (replay.status === "failed") {
        summary.replays.failed += 1;
      }
    }
    const scheduled = Array.isArray(order.scheduledReplays) ? order.scheduledReplays : [];
    summary.replays.scheduled += scheduled.filter((entry) => entry.status === "scheduled").length;
    const guardrails = extractGuardrails(order.payload);
    const providerCost = toFiniteNumber(order.payload?.providerCostAmount);
    const customerPrice = toFiniteNumber(order.amount);
    const serviceKey = order.serviceId || order.providerId || "unknown";
    const overrides = extractRuleOverrides(order.payload);
    if (overrides.length) {
      const overrideBucket = ensureRuleOverrideBucket(summary.ruleOverridesByService, serviceKey);
      overrides.forEach((rule) => applyRuleOverride(overrideBucket, rule));
    }
    if (!guardrails || providerCost == null || customerPrice == null) {
      continue;
    }
    const margin = evaluateMargin(guardrails, providerCost, customerPrice);
    applyGuardrailStatus(summary.guardrails, margin.status);
    const serviceSummary = ensureGuardrailBucket(summary.guardrailHitsByService, serviceKey);
    applyGuardrailStatus(serviceSummary, margin.status);
  }
  return summary;
}

export function computeProviderOrderMarginInsight(order: FulfillmentProviderOrder): ProviderOrderMarginInsight {
  const guardrails = extractGuardrails(order.payload);
  const providerCost = toFiniteNumber(order.payload?.providerCostAmount);
  const customerPrice = toFiniteNumber(order.amount);
  const margin = evaluateMargin(guardrails, providerCost, customerPrice);
  return {
    status: margin.status,
    marginValue: margin.marginValue,
    marginPercent: margin.marginPercent,
    providerCost,
    customerPrice,
    guardrails,
  };
}

function createGuardrailSummary(): GuardrailTelemetrySummary {
  return { evaluated: 0, pass: 0, warn: 0, fail: 0 };
}

function createReplaySummary(): ReplayTelemetrySummary {
  return { total: 0, executed: 0, failed: 0, scheduled: 0 };
}

function createRuleOverrideSummary(): RuleOverrideServiceSummary {
  return { totalOverrides: 0, rules: {} };
}

function ensureGuardrailBucket(
  map: Record<string, GuardrailTelemetrySummary>,
  key: string,
): GuardrailTelemetrySummary {
  if (!map[key]) {
    map[key] = createGuardrailSummary();
  }
  return map[key];
}

function ensureRuleOverrideBucket(
  map: Record<string, RuleOverrideServiceSummary>,
  key: string,
): RuleOverrideServiceSummary {
  if (!map[key]) {
    map[key] = createRuleOverrideSummary();
  }
  return map[key];
}

function applyGuardrailStatus(summary: GuardrailTelemetrySummary, status: MarginStatus): void {
  summary.evaluated += 1;
  if (status === "pass" || status === "warn" || status === "fail") {
    summary[status] += 1;
  }
}

type RuleOverrideSnapshot = {
  id: string;
  label: string | null;
};

function applyRuleOverride(summary: RuleOverrideServiceSummary, rule: RuleOverrideSnapshot): void {
  summary.totalOverrides += 1;
  const existing = summary.rules[rule.id];
  if (!existing) {
    summary.rules[rule.id] = { id: rule.id, label: rule.label, count: 1 };
    return;
  }
  if (!existing.label && rule.label) {
    existing.label = rule.label;
  }
  existing.count += 1;
}

type UnknownRecord = Record<string, unknown>;

function sanitizeRuleMetadata(
  metadata: FulfillmentProviderRuleMetadataMap | null | undefined,
): Record<string, ServiceOverrideRule> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const normalized: Record<string, ServiceOverrideRule> = {};
  for (const [ruleId, raw] of Object.entries(metadata)) {
    if (!raw) {
      continue;
    }
    const id = typeof raw.id === "string" && raw.id.trim().length ? raw.id.trim() : ruleId;
    const entryConditions = Array.isArray(raw.conditions)
      ? (raw.conditions as ServiceOverrideRule["conditions"])
      : [];
    const entryOverrides = isRecord(raw.overrides as unknown)
      ? (raw.overrides as ServiceOverrideRule["overrides"])
      : {};
    normalized[id] = {
      id,
      label: typeof raw.label === "string" ? raw.label : null,
      description: typeof raw.description === "string" ? raw.description : null,
      priority:
        typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Number(raw.priority) : null,
      conditions: entryConditions,
      overrides: entryOverrides,
    };
  }
  return normalized;
}

function createFallbackRule(ruleId: string): ServiceOverrideRule {
  return {
    id: ruleId,
    label: null,
    description: null,
    priority: null,
    conditions: [],
    overrides: {},
  };
}

function extractGuardrails(payload: UnknownRecord | null | undefined): ProviderServiceGuardrails | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (isRecord(payload.guardrails)) {
    return payload.guardrails as ProviderServiceGuardrails;
  }
  if (isRecord(payload.service) && isRecord(payload.service.metadata) && isRecord(payload.service.metadata.guardrails)) {
    return payload.service.metadata.guardrails as ProviderServiceGuardrails;
  }
  return undefined;
}

function extractRuleOverrides(payload: UnknownRecord | null | undefined): RuleOverrideSnapshot[] {
  if (!isRecord(payload) || !Array.isArray(payload.serviceRules)) {
    return [];
  }
  const snapshots: RuleOverrideSnapshot[] = [];
  for (const entry of payload.serviceRules) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }
    const normalizedId = entry.id.trim();
    if (!normalizedId) {
      continue;
    }
    const label =
      typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : null;
    snapshots.push({ id: normalizedId, label });
  }
  return snapshots;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
