// meta: test: rehearsalGuards
// meta: feature: marketing-preview-governance

import { describeFailureReasons, evaluateRehearsalGuard } from "../rehearsalGuards";
import type { MarketingPreviewHistoryTimelineEntry } from "../useMarketingPreviewHistory";

type TimelineRehearsal = MarketingPreviewHistoryTimelineEntry["rehearsals"][number];

const createRehearsal = (overrides: Partial<TimelineRehearsal> = {}): TimelineRehearsal => ({
  id: "reh-1",
  manifestGeneratedAt: "2024-05-02T00:00:00.000Z",
  scenarioFingerprint: "scenario::fingerprint",
  expectedDeltas: 2,
  operatorHash: null,
  payloadHash: "hash-1",
  recordedAt: "2024-05-02T01:00:00.000Z",
  verdict: "passed" as const,
  evaluatedAt: "2024-05-02T01:05:00.000Z",
  actualDeltas: 2,
  diff: 0,
  failureReasons: null,
  comparison: null,
  ...overrides
});

describe("rehearsalGuards", () => {
  test("flags missing rehearsal state when ledger empty", () => {
    const summary = evaluateRehearsalGuard([], "2024-05-02T00:00:00.000Z");

    expect(summary.state).toBe("missing");
    expect(summary.allowed).toBe(false);
    expect(summary.reasons[0]).toContain("No rehearsal");
  });

  test("allows remediation when latest rehearsal passed and is fresh", () => {
    const rehearsal = createRehearsal();
    const summary = evaluateRehearsalGuard([rehearsal], "2024-05-02T00:00:00.000Z");

    expect(summary.state).toBe("passed");
    expect(summary.allowed).toBe(true);
    expect(summary.reasons).toHaveLength(0);
  });

  test("marks rehearsal as stale when evaluation predates manifest", () => {
    const rehearsal = createRehearsal({ evaluatedAt: "2024-05-01T23:59:00.000Z" });
    const summary = evaluateRehearsalGuard([rehearsal], "2024-05-02T00:00:00.000Z");

    expect(summary.state).toBe("stale");
    expect(summary.allowed).toBe(false);
    expect(summary.reasons.some((reason) => reason.includes("predates"))).toBe(true);
  });

  test("reports failure reasons when rehearsal verdict failed", () => {
    const rehearsal = createRehearsal({
      verdict: "failed",
      failureReasons: ["manifest_missing", "delta_mismatch"],
      diff: 1
    });
    const summary = evaluateRehearsalGuard([rehearsal], "2024-05-02T00:00:00.000Z");

    expect(summary.state).toBe("failed");
    expect(summary.allowed).toBe(false);
    expect(summary.reasons.join(" ")).toContain("Manifest capture not found");
    expect(summary.reasons.join(" ")).toContain("additional live remediation");
  });

  test("describeFailureReasons formats diff deltas", () => {
    const messages = describeFailureReasons(["unexpected_remediation"], -2);

    expect(messages.some((message) => message.includes("Additional live"))).toBe(true);
    expect(messages.some((message) => message.includes("missing"))).toBe(true);
  });
});
