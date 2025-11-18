import { NextResponse } from "next/server";

import { readQuickOrderEventLines } from "@/server/telemetry/quick-order-storage";

const NDJSON_MIME = "application/x-ndjson";
const DEFAULT_FILENAME = "quick-order-events.ndjson";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : null;
    const limit =
      parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : undefined;

    const lines = await readQuickOrderEventLines({ limit });
    if (!lines.length) {
      return NextResponse.json({ error: "No quick-order telemetry events captured yet." }, { status: 404 });
    }

    const body = lines.join("\n") + "\n";
    const headers = new Headers();
    headers.set("Content-Type", NDJSON_MIME);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Quick-Order-Events", lines.length.toString());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    headers.set("Content-Disposition", `attachment; filename="quick-order-${timestamp}-${DEFAULT_FILENAME}"`);

    return new NextResponse(body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Failed to stream quick-order telemetry export", error);
    return NextResponse.json({ error: "Unable to export quick-order telemetry" }, { status: 500 });
  }
}

