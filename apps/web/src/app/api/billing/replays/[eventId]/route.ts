import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { triggerProcessorReplay } from "@/server/billing/replays";

export async function POST(request: Request, { params }: { params: { eventId: string } }) {
  const incomingHeaders = headers();

  let force = false;
  try {
    const payload = (await request.json()) as { force?: boolean };
    force = Boolean(payload?.force);
  } catch (_error) {
    force = false;
  }

  const result = await triggerProcessorReplay(params.eventId, { force }, incomingHeaders);

  if (!result.ok || !result.event) {
    return NextResponse.json({ error: result.error ?? "Unable to trigger replay." }, {
      status: result.status,
    });
  }

  return NextResponse.json({ event: result.event }, { status: result.status });
}
