// meta: route: api/marketing-preview/history/governance
// meta: feature: marketing-preview-governance

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createHistoryHash, recordGovernanceAction } from "@/server/cms/history";

const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const authenticate = (request: Request) => {
  if (!LIVE_PREVIEW_SECRET) {
    return false;
  }
  const signature = request.headers.get("x-preview-signature");
  return signature === LIVE_PREVIEW_SECRET;
};

type GovernanceActionPayload = {
  manifestId?: string;
  actionKind?: string;
  actorId?: string;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  id?: string;
};

const sanitizeMetadata = (metadata: unknown): Record<string, unknown> | undefined => {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return undefined;
};

export async function POST(request: Request) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as GovernanceActionPayload | null;

  if (!payload || typeof payload.actionKind !== "string" || !payload.actionKind.trim()) {
    return NextResponse.json({ error: "Missing action kind" }, { status: 400 });
  }

  if (!payload.manifestId || typeof payload.manifestId !== "string") {
    return NextResponse.json({ error: "Missing manifest identifier" }, { status: 400 });
  }

  const actionId = payload.id ?? randomUUID();
  const createdAt = payload.occurredAt ?? new Date().toISOString();
  const metadata = sanitizeMetadata(payload.metadata ?? undefined);
  const actorHash = payload.actorId ? createHistoryHash(payload.actorId) : undefined;

  recordGovernanceAction({
    id: actionId,
    manifestId: payload.manifestId,
    actorHash,
    actionKind: payload.actionKind,
    metadata,
    createdAt
  });

  return NextResponse.json(
    {
      action: {
        id: actionId,
        manifestId: payload.manifestId,
        actorHash: actorHash ?? null,
        actionKind: payload.actionKind,
        metadata: metadata ?? null,
        createdAt
      }
    },
    { status: 201 }
  );
}
