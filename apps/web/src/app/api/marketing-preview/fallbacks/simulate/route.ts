import { NextResponse } from "next/server";

import { querySnapshotHistory, recordRehearsalAction } from "@/server/cms/history";

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
    return { manifestFound: false, remediationCount: 0 };
  }

  const history = querySnapshotHistory({ limit: 50, actionMode: "live" });
  const matching = history.entries.find((entry) => entry.generatedAt === manifestGeneratedAt);

  if (!matching) {
    return { manifestFound: false, remediationCount: 0 };
  }

  return { manifestFound: true, remediationCount: matching.remediations.length };
};

export async function POST(request: Request) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as RehearsalSimulationPayload | null;

  if (!validatePayload(payload)) {
    return NextResponse.json({ error: "Invalid rehearsal payload" }, { status: 400 });
  }

  recordRehearsalAction({
    manifestGeneratedAt: payload.manifestGeneratedAt ?? null,
    scenarioFingerprint: payload.scenarioFingerprint,
    expectedDeltas: payload.expectedDeltas,
    operatorId: payload.operatorId ?? null
  });

  const { manifestFound, remediationCount } = summarizeLiveRemediations(payload.manifestGeneratedAt ?? null);
  const diff = remediationCount - payload.expectedDeltas;

  return NextResponse.json(
    {
      rehearsal: {
        manifestGeneratedAt: payload.manifestGeneratedAt ?? null,
        scenarioFingerprint: payload.scenarioFingerprint,
        expectedDeltas: payload.expectedDeltas,
        operatorId: payload.operatorId ? "hashed" : null
      },
      liveOutcomes: {
        manifestFound,
        remediationCount,
        diff
      }
    },
    { status: 201 }
  );
}
