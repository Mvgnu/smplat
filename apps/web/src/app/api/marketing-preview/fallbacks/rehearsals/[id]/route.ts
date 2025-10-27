import { NextResponse } from "next/server";

import { getRehearsalAction, querySnapshotHistory } from "@/server/cms/history";

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

const evaluateLiveOutcomes = (manifestGeneratedAt?: string | null) => {
  if (!manifestGeneratedAt) {
    return { manifestFound: false, remediationCount: 0 };
  }

  const history = querySnapshotHistory({ limit: 50, actionMode: "live" });
  const matching = history.entries.find((entry) => entry.generatedAt === manifestGeneratedAt);

  if (!matching) {
    return { manifestFound: false, remediationCount: 0 };
  }

  return { manifestFound: true, remediationCount: matching.remediations.length };
};

export async function GET(request: Request, context: { params: { id: string } }) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rehearsal = getRehearsalAction(context.params.id);

  if (!rehearsal) {
    return NextResponse.json({ error: "Rehearsal not found" }, { status: 404 });
  }

  const { manifestFound, remediationCount } = evaluateLiveOutcomes(rehearsal.manifestGeneratedAt ?? null);
  const diff = remediationCount - rehearsal.expectedDeltas;

  return NextResponse.json({
    rehearsal,
    liveOutcomes: {
      manifestFound,
      remediationCount,
      diff
    }
  });
}
