import { NextResponse } from "next/server";

import {
  getRehearsalAction,
  querySnapshotHistory,
  type MarketingPreviewRehearsalComparison,
  type MarketingPreviewRehearsalFailureReason,
  type MarketingPreviewRehearsalVerdict,
  type MarketingPreviewRemediationActionRecord
} from "@/server/cms/history";

// meta: route: api/marketing-preview/fallbacks/rehearsals/[id]
// meta: feature: marketing-preview-governance

const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const authenticate = (request: Request) => {
  if (!LIVE_PREVIEW_SECRET) {
    return false;
  }
  const signature = request.headers.get("x-preview-signature");
  return signature === LIVE_PREVIEW_SECRET;
};

const summarizeLiveOutcomes = (manifestGeneratedAt?: string | null) => {
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
  summary: ReturnType<typeof summarizeLiveOutcomes>
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

export async function GET(request: Request, context: { params: { id: string } }) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rehearsal = getRehearsalAction(context.params.id);

  if (!rehearsal) {
    return NextResponse.json({ error: "Rehearsal not found" }, { status: 404 });
  }

  const summary = summarizeLiveOutcomes(rehearsal.manifestGeneratedAt ?? null);
  const evaluation = evaluateRehearsal(rehearsal.expectedDeltas, summary);

  return NextResponse.json({
    rehearsal,
    liveEvaluation: evaluation
  });
}
