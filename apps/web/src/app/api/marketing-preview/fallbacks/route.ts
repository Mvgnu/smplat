import { NextResponse } from "next/server";

// meta: route: api/marketing-preview/fallbacks
// meta: feature: marketing-preview-governance

const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const fallbackActionCounters = {
  reset: 0,
  prioritize: 0,
  rejected: 0
};

type FallbackGovernancePayload = {
  route?: string;
  action?: "reset" | "prioritize";
  fingerprint?: string;
  summary?: {
    totalBlocks?: number;
    invalidBlocks?: number;
    warningBlocks?: number;
  } | null;
  collection?: string;
  docId?: string | null;
};

type ValidatedFallbackPayload = {
  route: string;
  action: "reset" | "prioritize";
  fingerprint?: string;
  summary?: {
    totalBlocks?: number;
    invalidBlocks?: number;
    warningBlocks?: number;
  } | null;
  collection?: string;
  docId?: string | null;
};

const authenticate = (request: Request) => {
  if (!LIVE_PREVIEW_SECRET) {
    return false;
  }
  const signature = request.headers.get("x-preview-signature");
  return signature === LIVE_PREVIEW_SECRET;
};

const validateBody = (body: FallbackGovernancePayload | null): body is ValidatedFallbackPayload => {
  if (!body || typeof body.route !== "string" || body.route.trim().length === 0) {
    return false;
  }
  if (body.action !== "reset" && body.action !== "prioritize") {
    return false;
  }
  if (body.action === "prioritize") {
    if (typeof body.fingerprint !== "string" || body.fingerprint.length === 0) {
      return false;
    }
  }
  return true;
};

export async function POST(request: Request) {
  if (!authenticate(request)) {
    fallbackActionCounters.rejected += 1;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as FallbackGovernancePayload | null;

  if (!validateBody(payload)) {
    fallbackActionCounters.rejected += 1;
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (payload.action === "reset") {
    fallbackActionCounters.reset += 1;
  } else {
    fallbackActionCounters.prioritize += 1;
  }

  const acknowledgedAt = new Date().toISOString();

  return NextResponse.json({
    acknowledged: true,
    acknowledgedAt,
    action: payload.action,
    route: payload.route,
    fingerprint: payload.fingerprint ?? null,
    counters: { ...fallbackActionCounters },
    summary: payload.summary ?? null,
    collection: payload.collection ?? null,
    docId: payload.docId ?? null
  });
}
