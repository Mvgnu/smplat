import { NextResponse } from "next/server";

import { readGuardrailWorkflowEvents } from "@/server/telemetry/guardrail-workflow-storage";

const NDJSON_MIME = "application/x-ndjson";
const DEFAULT_FILENAME = "guardrail-workflow-events.ndjson";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : null;
    const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : undefined;

    const events = await readGuardrailWorkflowEvents(limit);
    if (!events.length) {
      return NextResponse.json({ error: "No guardrail workflow telemetry captured yet." }, { status: 404 });
    }

    const lines = events.map((event) => JSON.stringify(event));
    const body = lines.join("\n") + "\n";
    const headers = new Headers();
    headers.set("Content-Type", NDJSON_MIME);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Guardrail-Workflow-Events", lines.length.toString());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    headers.set("Content-Disposition", `attachment; filename="guardrail-workflow-${timestamp}-${DEFAULT_FILENAME}"`);

    return new NextResponse(body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Failed to stream guardrail workflow telemetry export", error);
    return NextResponse.json({ error: "Unable to export guardrail workflow telemetry" }, { status: 500 });
  }
}
