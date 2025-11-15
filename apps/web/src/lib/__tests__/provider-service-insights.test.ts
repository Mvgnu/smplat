import type { FulfillmentProviderOrder, FulfillmentProviderOrderReplayEntry } from "@/types/fulfillment";
import type { ProviderServiceCostModel } from "@smplat/types";
import {
  buildReplayRuleMetadata,
  describeCadence,
  describeCostModel,
  describeGuardrails,
  estimateProviderCost,
  evaluateMargin,
  formatCurrency,
  summarizeProviderAutomationTelemetry,
  computeProviderOrderMarginInsight,
  safePositiveNumber,
} from "../provider-service-insights";

describe("provider-service-insights helpers", () => {
  it("estimates per-unit cost while respecting minimum units", () => {
    const model: ProviderServiceCostModel = {
      kind: "per_unit",
      unitAmount: 0.5,
      minimumUnits: 100,
      currency: "USD",
    };

    expect(estimateProviderCost(model, 40)).toBeCloseTo(50); // minimum 100 units * 0.5
    expect(estimateProviderCost(model, 250)).toBeCloseTo(125);
  });

  it("handles tiered pricing windows", () => {
    const model: ProviderServiceCostModel = {
      kind: "tiered",
      currency: "USD",
      tiers: [
        { upTo: 100, unitAmount: 1 },
        { upTo: 200, unitAmount: 0.75 },
        { unitAmount: 0.5 },
      ],
    };

    expect(estimateProviderCost(model, 50)).toBe(50);
    expect(estimateProviderCost(model, 150)).toBeCloseTo(137.5); // 100*1 + 50*0.75
    expect(estimateProviderCost(model, 260)).toBeCloseTo(205); // 100*1 + 100*0.75 + 60*0.5
  });

  it("evaluates margin guardrails for pass/warn/fail states", () => {
    const guardrails = {
      minimumMarginPercent: 25,
      warningMarginPercent: 40,
      minimumMarginAbsolute: 10,
    };

    expect(evaluateMargin(guardrails, 90, 100)).toMatchObject({ status: "fail", marginValue: 10 });
    expect(evaluateMargin(guardrails, 65, 100).status).toBe("warn"); // 35% margin < warning threshold
    expect(evaluateMargin(guardrails, 30, 100).status).toBe("pass");
    expect(evaluateMargin(guardrails, null, 100).status).toBe("idle");
    expect(evaluateMargin(guardrails, 20, null).status).toBe("idle");
  });

  it("describes cost, cadence, and guardrails for admin surfaces", () => {
    const costDescription = describeCostModel(
      {
        kind: "per_unit",
        unitAmount: 3.5,
        unit: "follower",
        minimumUnits: 100,
        currency: "EUR",
      },
      "EUR",
    );
    expect(costDescription[0]).toContain("3.5");
    expect(costDescription[0]).toContain("follower");

    const cadenceDescription = describeCadence({
      batchSize: 50,
      defaultDailyQuota: 500,
      fulfillmentWindowHours: 24,
      expectedCompletionHours: 48,
      refillWindowHours: 12,
      notes: "Paused on weekends",
    });
    expect(cadenceDescription).toEqual(
      expect.arrayContaining(["Batch size 50", "500 / day", "Fulfillment window ~24h", "Expected completion ~48h"]),
    );

    const guardrailDescription = describeGuardrails(
      {
        minimumMarginPercent: 30,
        warningMarginPercent: 45,
        minimumMarginAbsolute: 25,
        notes: "Align with headline margin goals",
      },
      "USD",
    );
    expect(guardrailDescription.join(" ")).toMatch(/30\.0%/);
    expect(guardrailDescription.join(" ")).toMatch(/45\.0%/);
    expect(guardrailDescription.join(" ")).toMatch(/\$25\.00/);
  });

  it("formats currency fallbacks and positive numbers safely", () => {
    expect(formatCurrency(12.3456, "USD")).toBe("$12.35");
    expect(formatCurrency(9.5, undefined)).toBe("$9.50");
    expect(safePositiveNumber(" 42 ")).toBe(42);
    expect(safePositiveNumber("-1")).toBeUndefined();
    expect(safePositiveNumber(null)).toBeUndefined();
  });

  it("builds replay rule metadata snapshots for telemetry chips", () => {
    const entry: FulfillmentProviderOrderReplayEntry = {
      id: "replay-1",
      status: "executed",
      requestedAmount: null,
      currency: "USD",
      performedAt: "2025-01-01T00:00:00.000Z",
      scheduledFor: null,
      response: null,
      ruleIds: ["rule-a", "rule-b"],
      ruleMetadata: {
        "rule-a": {
          id: "rule-a",
          label: "High margin guardrail",
          conditions: [{ kind: "channel", channels: ["storefront"] }],
          overrides: { marginTarget: 30 },
        },
      },
    };

    const rules = buildReplayRuleMetadata(entry);
    expect(rules).toHaveLength(2);
    expect(rules[0].label).toBe("High margin guardrail");
    expect(rules[0].conditions?.[0]).toMatchObject({ kind: "channel" });
    expect(rules[1].id).toBe("rule-b");
    expect(rules[1].conditions).toEqual([]);
    expect(rules[1].overrides).toEqual({});
  });

  it("summarizes replay outcomes and guardrail hits for analytics surfaces", () => {
    const summary = summarizeProviderAutomationTelemetry([
      buildProviderOrder({
        replays: [
          { id: "r-1", status: "executed" },
          { id: "r-2", status: "failed" },
        ],
        scheduledReplays: [
          { id: "s-1", status: "scheduled" },
          { id: "s-2", status: "failed" },
        ],
        amount: 110,
        payload: {
          providerCostAmount: 100,
          guardrails: { minimumMarginPercent: 25 },
          serviceRules: [
            { id: "rule-boost", label: "Boost conversions" },
            { id: "rule-boost", label: "Boost conversions" },
          ],
        },
      }),
      buildProviderOrder({
        id: "order-2",
        serviceId: "svc-2",
        replays: [{ id: "r-3", status: "executed" }],
        scheduledReplays: [],
        amount: 150,
        payload: {
          service: { metadata: { guardrails: { warningMarginPercent: 40 } } },
          providerCostAmount: 110,
          serviceRules: [{ id: "rule-delay", label: "Delay dispatch" }],
        },
      }),
    ]);

    expect(summary.totalOrders).toBe(2);
    expect(summary.replays).toMatchObject({ total: 3, executed: 2, failed: 1, scheduled: 1 });
    expect(summary.guardrails).toMatchObject({ evaluated: 2, fail: 1, warn: 1, pass: 0 });
    expect(summary.guardrailHitsByService["svc-1"].fail).toBe(1);
    expect(summary.guardrailHitsByService["svc-2"].warn).toBe(1);
    expect(summary.ruleOverridesByService["svc-1"].totalOverrides).toBe(2);
    expect(summary.ruleOverridesByService["svc-1"].rules["rule-boost"].count).toBe(2);
    expect(summary.ruleOverridesByService["svc-2"].rules["rule-delay"].label).toBe("Delay dispatch");
  });

  it("returns empty telemetry when no provider orders exist", () => {
    expect(summarizeProviderAutomationTelemetry(undefined)).toEqual({
      totalOrders: 0,
      replays: { total: 0, executed: 0, failed: 0, scheduled: 0 },
      guardrails: { evaluated: 0, pass: 0, warn: 0, fail: 0 },
      guardrailHitsByService: {},
      ruleOverridesByService: {},
    });
  });

  it("derives provider order margin insight for targeted warnings", () => {
    const insight = computeProviderOrderMarginInsight(
      buildProviderOrder({
        amount: 150,
        payload: {
          providerCostAmount: 130,
          guardrails: { minimumMarginPercent: 10, warningMarginPercent: 20 },
        },
      }),
    );

    expect(insight.customerPrice).toBe(150);
    expect(insight.providerCost).toBe(130);
    expect(insight.status).toBe("warn");
    expect(insight.guardrails?.minimumMarginPercent).toBe(10);
  });
});

function buildProviderOrder(overrides: Partial<FulfillmentProviderOrder> = {}): FulfillmentProviderOrder {
  return {
    id: overrides.id ?? "order-1",
    providerId: overrides.providerId ?? "provider-1",
    providerName: overrides.providerName ?? "Provider One",
    serviceId: overrides.serviceId ?? "svc-1",
    serviceAction: overrides.serviceAction ?? "order",
    orderId: overrides.orderId ?? "order-db-1",
    orderItemId: overrides.orderItemId ?? "order-item-1",
    amount: overrides.amount ?? 120,
    currency: overrides.currency ?? "USD",
    providerOrderId: overrides.providerOrderId ?? "remote-1",
    payload:
      overrides.payload ??
      ({
        providerCostAmount: 90,
        guardrails: { minimumMarginPercent: 20 },
      } as Record<string, unknown>),
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00.000Z",
    refills: overrides.refills ?? [],
    replays: overrides.replays ?? [],
    scheduledReplays: overrides.scheduledReplays ?? [],
  };
}
