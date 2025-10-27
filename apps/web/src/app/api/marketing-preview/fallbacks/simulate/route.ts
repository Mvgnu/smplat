import { NextResponse } from "next/server";

import {
  querySnapshotHistory,
  recordRehearsalAction,
  type MarketingPreviewRehearsalComparison,
  type MarketingPreviewRehearsalFailureReason,
  type MarketingPreviewRehearsalVerdict,
  type MarketingPreviewRemediationActionRecord
} from "@/server/cms/history";

// meta: route: api/marketing-preview/fallbacks/simulate
// meta: feature: marketing-preview-governance

const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const authenticate = (request: Request) => {
  if (!LIVE_PREVIEW_SECRET) {
    return false;
  }
  const signature = request.headers.get("x-preview-signature");
  return signature === LIVE_PREVIEW_SECRET;
};

type RehearsalSimulationPayload = {
  manifestGeneratedAt?: string | null;
  scenarioFingerprint?: string;
  expectedDeltas?: number;
  operatorId?: string | null;
};

const validatePayload = (
  payload: RehearsalSimulationPayload | null
): payload is Required<Pick<RehearsalSimulationPayload, "scenarioFingerprint" | "expectedDeltas">> &
  Omit<RehearsalSimulationPayload, "scenarioFingerprint" | "expectedDeltas"> => {
  if (!payload) {
    return false;
  }
  if (!payload.scenarioFingerprint || typeof payload.scenarioFingerprint !== "string") {
    return false;
  }
  if (typeof payload.expectedDeltas !== "number" || Number.isNaN(payload.expectedDeltas)) {
    return false;
  }
  return true;
};

const summarizeLiveRemediations = (manifestGeneratedAt?: string | null) => {
  if (!manifestGeneratedAt) {
    return { manifestFound: false, remediations: [] as MarketingPreviewRemediationActionRecord[] };
  }

  const history = querySnapshotHistory({ limit: 50, actionMode: "live" });
  const matching = history.entries.find((entry) => entry.generatedAt === manifestGeneratedAt);

  if (!matching) {
    return { manifestFound: false, remediations: [] as MarketingPreviewRemediationActionRecord[] };
  }

  return { manifestFound: true, remediations: matching.remediations };
};

const evaluateRehearsal = (
  expectedDeltas: number,
  summary: ReturnType<typeof summarizeLiveRemediations>
) => {
  const actualCount = summary.remediations.length;
  const diff = actualCount - expectedDeltas;
  const failureReasons: MarketingPreviewRehearsalFailureReason[] = [];

  if (!summary.manifestFound) {
    failureReasons.push("manifest_missing");
  }

  if (actualCount !== expectedDeltas) {
    failureReasons.push("delta_mismatch");
    if (actualCount > expectedDeltas) {
      failureReasons.push("unexpected_remediation");
    }
  }

  const verdict: MarketingPreviewRehearsalVerdict = failureReasons.length ? "failed" : "passed";

  const comparison: MarketingPreviewRehearsalComparison = {
    expected: { deltaCount: expectedDeltas },
    actual: {
      manifestFound: summary.manifestFound,
      remediationCount: actualCount,
      remediations: summary.remediations.map((remediation) => ({
        id: remediation.id,
        route: remediation.route,
        action: remediation.action,
        fingerprint: remediation.fingerprint ?? null,
        recordedAt: remediation.recordedAt
      }))
    }
  };

  return { verdict, diff, actualDeltas: actualCount, failureReasons, comparison };
};

export async function POST(request: Request) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as RehearsalSimulationPayload | null;

  if (!validatePayload(payload)) {
    return NextResponse.json({ error: "Invalid rehearsal payload" }, { status: 400 });
  }

  const summary = summarizeLiveRemediations(payload.manifestGeneratedAt ?? null);
  const evaluation = evaluateRehearsal(payload.expectedDeltas, summary);
  const evaluatedAt = new Date().toISOString();

  recordRehearsalAction({
    manifestGeneratedAt: payload.manifestGeneratedAt ?? null,
    scenarioFingerprint: payload.scenarioFingerprint,
    expectedDeltas: payload.expectedDeltas,
    operatorId: payload.operatorId ?? null,
    verdict: evaluation.verdict,
    actualDeltas: evaluation.actualDeltas,
    diff: evaluation.diff,
    failureReasons: evaluation.failureReasons,
    comparison: evaluation.comparison,
    evaluatedAt
  });

  return NextResponse.json(
    {
      rehearsal: {
        manifestGeneratedAt: payload.manifestGeneratedAt ?? null,
        scenarioFingerprint: payload.scenarioFingerprint,
        expectedDeltas: payload.expectedDeltas,
        operatorId: payload.operatorId ? "hashed" : null
      },
      evaluation: {
        verdict: evaluation.verdict,
        diff: evaluation.diff,
        actualDeltas: evaluation.actualDeltas,
        failureReasons: evaluation.failureReasons,
        comparison: evaluation.comparison
      }
    },
    { status: 201 }
  );
}
