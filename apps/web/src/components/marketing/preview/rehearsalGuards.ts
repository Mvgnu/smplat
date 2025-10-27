// meta: module: marketing-preview-rehearsal-guards
// meta: feature: marketing-preview-governance

import type {
  MarketingPreviewRehearsalFailureReason,
  MarketingPreviewRehearsalVerdict
} from "@/server/cms/history";

import type { MarketingPreviewHistoryTimelineEntry } from "./useMarketingPreviewHistory";

type TimelineRehearsal = MarketingPreviewHistoryTimelineEntry["rehearsals"][number];

export type RehearsalGuardState = "missing" | "passed" | "failed" | "pending" | "stale";

export type RehearsalGuardSummary = {
  latest: TimelineRehearsal | null;
  state: RehearsalGuardState;
  allowed: boolean;
  isFresh: boolean;
  reasons: string[];
};

const parseTimestamp = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const describeFailureReasons = (
  reasons: MarketingPreviewRehearsalFailureReason[] | null | undefined,
  diff?: number | null
): string[] => {
  if (!reasons?.length && (!diff || diff === 0)) {
    return [];
  }

  const messages: string[] = [];

  for (const reason of reasons ?? []) {
    if (reason === "manifest_missing") {
      messages.push("Manifest capture not found in live fallbacks. Capture a new snapshot and rerun the rehearsal.");
    } else if (reason === "delta_mismatch") {
      messages.push("Expected remediation count does not match live fallbacks. Review playbook coverage before proceeding.");
    } else if (reason === "unexpected_remediation") {
      messages.push("Additional live remediations triggered outside the rehearsal plan.");
    }
  }

  if (typeof diff === "number" && diff !== 0) {
    const magnitude = Math.abs(diff);
    if (diff > 0) {
      messages.push(`${magnitude} additional live remediation${magnitude === 1 ? "" : "s"} detected.`);
    } else {
      messages.push(`${magnitude} expected remediation${magnitude === 1 ? "" : "s"} missing from live history.`);
    }
  }

  return messages;
};

const sortRehearsals = (rehearsals: TimelineRehearsal[]): TimelineRehearsal[] => {
  return [...rehearsals].sort((a, b) => {
    const aTimestamp = parseTimestamp(a.evaluatedAt ?? a.recordedAt) ?? 0;
    const bTimestamp = parseTimestamp(b.evaluatedAt ?? b.recordedAt) ?? 0;
    return bTimestamp - aTimestamp;
  });
};

export const evaluateRehearsalGuard = (
  rehearsals: TimelineRehearsal[],
  manifestGeneratedAt: string
): RehearsalGuardSummary => {
  if (!rehearsals.length) {
    return {
      latest: null,
      state: "missing",
      allowed: false,
      isFresh: false,
      reasons: ["No rehearsal recorded for this manifest. Run a rehearsal before remediating live fallbacks."]
    };
  }

  const [latest] = sortRehearsals(rehearsals);
  const manifestTimestamp = parseTimestamp(manifestGeneratedAt);
  const evaluationTimestamp = parseTimestamp(latest.evaluatedAt ?? latest.recordedAt);
  const isFresh = Boolean(
    manifestTimestamp !== null &&
      evaluationTimestamp !== null &&
      evaluationTimestamp >= manifestTimestamp
  );

  const baseReasons: string[] = [];
  let state: RehearsalGuardState;
  const verdict: MarketingPreviewRehearsalVerdict = latest.verdict ?? "pending";

  if (verdict === "failed") {
    state = "failed";
    baseReasons.push(...describeFailureReasons(latest.failureReasons, latest.diff));
    if (!baseReasons.length) {
      baseReasons.push("Latest rehearsal failed. Investigate discrepancies before remediating.");
    }
  } else if (verdict === "pending") {
    state = "pending";
    baseReasons.push("Latest rehearsal is awaiting evaluation.");
  } else if (!isFresh) {
    state = "stale";
    baseReasons.push("Latest rehearsal predates this manifest capture. Re-run rehearsal to refresh guardrails.");
  } else {
    state = "passed";
  }

  const allowed = state === "passed";

  return {
    latest,
    state,
    allowed,
    isFresh,
    reasons: allowed ? [] : baseReasons
  };
};
