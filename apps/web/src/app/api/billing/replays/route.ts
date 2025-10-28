import { NextResponse } from "next/server";

import { fetchProcessorReplays } from "@/server/billing/replays";
import type { ProcessorReplayStatus } from "@/server/billing/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? undefined;
  const status = searchParams.get("status") as ProcessorReplayStatus | "all" | null;
  const correlationId = searchParams.get("correlationId") ?? undefined;
  const limitParam = searchParams.get("limit");
  const workspaceParam = searchParams.get("workspaceId");
  const workspaceId = workspaceParam && workspaceParam !== "__unassigned__" ? workspaceParam : undefined;
  const since = searchParams.get("since") ?? undefined;
  const requestedOnlyParam = searchParams.get("requestedOnly");

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const requestedOnly =
    requestedOnlyParam !== null ? requestedOnlyParam.toLowerCase() === "true" : undefined;

  const events = await fetchProcessorReplays({
    provider,
    status: status ?? undefined,
    correlationId: correlationId ?? undefined,
    limit,
    workspaceId,
    since: since ?? undefined,
    requestedOnly,
  });

  return NextResponse.json({ events });
}
