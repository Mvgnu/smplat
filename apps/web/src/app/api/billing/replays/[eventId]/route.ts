import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { fetchProcessorReplayDetail, triggerProcessorReplay } from "@/server/billing/replays";

export async function POST(request: Request, { params }: { params: { eventId: string } }) {
  const incomingHeaders = headers();
  const { searchParams } = new URL(request.url);
  const workspaceParam = searchParams.get("workspaceId");
  const workspaceId = workspaceParam && workspaceParam !== "__unassigned__" ? workspaceParam : undefined;

  let force = false;
  try {
    const payload = (await request.json()) as { force?: boolean };
    force = Boolean(payload?.force);
  } catch (_error) {
    force = false;
  }

  const result = await triggerProcessorReplay(
    params.eventId,
    { force },
    incomingHeaders,
    { workspaceId },
  );

  if (!result.ok || !result.event) {
    return NextResponse.json({ error: result.error ?? "Unable to trigger replay." }, {
      status: result.status,
    });
  }

  return NextResponse.json({ event: result.event }, { status: result.status });
}

export async function GET(request: Request, { params }: { params: { eventId: string } }) {
  const { searchParams } = new URL(request.url);
  const workspaceParam = searchParams.get("workspaceId");
  const workspaceId = workspaceParam && workspaceParam !== "__unassigned__" ? workspaceParam : undefined;

  const detail = await fetchProcessorReplayDetail(params.eventId, { workspaceId });

  if (!detail) {
    return NextResponse.json({ error: "Replay detail not found" }, { status: 404 });
  }

  return NextResponse.json({ event: detail });
}
